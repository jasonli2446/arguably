"use server"

import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/actions/utils"
import { SessionStatus } from "@/lib/generated/prisma"
import {
  computeParticipantStats,
  computeSessionStats,
  normalizeTurnLogs,
  formatAnalyticsCsv,
  type TurnLogEntry,
  type TranscriptEntry,
  type ParticipantStats,
  type SessionStats,
  type NormalizedTurn,
} from "@/lib/analytics"

/**
 * Auth helper: requires authenticated user + session must be ENDED.
 * Does NOT use requireParticipant (all participants have left_at set for ended sessions).
 */
async function requireEndedSession(code: string) {
  const user = await requireAuth()

  const session = await prisma.session.findUnique({
    where: { code },
    include: {
      host: { select: { id: true, username: true, realname: true } },
      moderator: { select: { id: true, username: true, realname: true } },
    },
  })
  if (!session) throw new Error("Session not found")
  if (session.status !== SessionStatus.ENDED) throw new Error("Session has not ended")

  return { user, session }
}

export interface ReplayData {
  session: {
    id: string
    code: string
    name: string
    description: string | null
    type: string
    turnLength: number
    createdAt: string
    endedAt: string | null
    host: { id: string; username: string; realname: string | null }
    moderator: { id: string; username: string; realname: string | null } | null
  }
  turns: NormalizedTurn[]
  transcripts: {
    id: string
    speakerId: string
    speakerName: string
    content: string
    timestamp: number
    duration: number | null
  }[]
  participants: {
    userId: string
    username: string
    realname: string | null
    sessionRole: string
  }[]
  debateStartTime: number | null // epoch ms
  debateDuration: number // seconds
  analytics: {
    participants: ParticipantStats[]
    session: SessionStats
  }
}

export async function getReplayData(sessionCode: string): Promise<ReplayData> {
  const { session } = await requireEndedSession(sessionCode)

  // Fetch TurnLogs via DebateState (TurnLog is keyed by debate_state_id, not session_id)
  const turnLogs = await prisma.turnLog.findMany({
    where: { debate_state: { session_id: session.id } },
    orderBy: { started_at: "asc" },
  })

  // Fetch Transcripts
  const transcripts = await prisma.transcript.findMany({
    where: { session_id: session.id },
    orderBy: { timestamp: "asc" },
    include: {
      speaker: { select: { id: true, username: true, realname: true } },
    },
  })

  // Fetch participants
  const participants = await prisma.participatesIn.findMany({
    where: { session_id: session.id },
    include: {
      user: { select: { id: true, username: true, realname: true } },
    },
  })

  // Compute analytics
  const turnLogEntries: TurnLogEntry[] = turnLogs.map((t) => ({
    id: t.id,
    speaker_user_id: t.speaker_user_id,
    speaker_name: t.speaker_name,
    turn_index: t.turn_index,
    reason: t.reason,
    started_at: t.started_at,
    ended_at: t.ended_at,
    duration_sec: t.duration_sec,
  }))

  const transcriptEntries: TranscriptEntry[] = transcripts.map((t) => ({
    id: t.id,
    speaker_id: t.speaker_id,
    content: t.content,
    timestamp: t.timestamp,
    duration: t.duration,
  }))

  const sessionStats = computeSessionStats(turnLogEntries)
  const participantStats = computeParticipantStats(
    turnLogEntries,
    transcriptEntries,
    sessionStats.debateDuration
  )

  // Compute total words for session stats
  const totalWords = participantStats.reduce((sum, p) => sum + p.wordsSpoken, 0)
  sessionStats.totalWords = totalWords

  // Normalize turns to seconds-from-debate-start
  const debateStartTime = sessionStats.debateStartTime
  const normalizedTurns = debateStartTime
    ? normalizeTurnLogs(turnLogEntries, debateStartTime)
    : []

  return {
    session: {
      id: session.id,
      code: session.code,
      name: session.name,
      description: session.description,
      type: session.type,
      turnLength: session.turn_length,
      createdAt: session.created_at.toISOString(),
      endedAt: session.ended_at?.toISOString() ?? null,
      host: {
        id: session.host.id,
        username: session.host.username,
        realname: session.host.realname,
      },
      moderator: session.moderator
        ? {
            id: session.moderator.id,
            username: session.moderator.username,
            realname: session.moderator.realname,
          }
        : null,
    },
    turns: normalizedTurns,
    transcripts: transcripts.map((t) => ({
      id: t.id,
      speakerId: t.speaker_id,
      speakerName: t.speaker.realname ?? t.speaker.username,
      content: t.content,
      timestamp: t.timestamp,
      duration: t.duration,
    })),
    participants: participants.map((p) => ({
      userId: p.user.id,
      username: p.user.username,
      realname: p.user.realname,
      sessionRole: p.session_role,
    })),
    debateStartTime: debateStartTime?.getTime() ?? null,
    debateDuration: sessionStats.debateDuration,
    analytics: {
      participants: participantStats,
      session: sessionStats,
    },
  }
}

export async function getSessionAnalytics(sessionCode: string) {
  const { session } = await requireEndedSession(sessionCode)

  const turnLogs = await prisma.turnLog.findMany({
    where: { debate_state: { session_id: session.id } },
    orderBy: { started_at: "asc" },
  })

  const transcripts = await prisma.transcript.findMany({
    where: { session_id: session.id },
    orderBy: { timestamp: "asc" },
  })

  const turnLogEntries: TurnLogEntry[] = turnLogs.map((t) => ({
    id: t.id,
    speaker_user_id: t.speaker_user_id,
    speaker_name: t.speaker_name,
    turn_index: t.turn_index,
    reason: t.reason,
    started_at: t.started_at,
    ended_at: t.ended_at,
    duration_sec: t.duration_sec,
  }))

  const transcriptEntries: TranscriptEntry[] = transcripts.map((t) => ({
    id: t.id,
    speaker_id: t.speaker_id,
    content: t.content,
    timestamp: t.timestamp,
    duration: t.duration,
  }))

  const sessionStats = computeSessionStats(turnLogEntries)
  const participantStats = computeParticipantStats(
    turnLogEntries,
    transcriptEntries,
    sessionStats.debateDuration
  )
  sessionStats.totalWords = participantStats.reduce((sum, p) => sum + p.wordsSpoken, 0)

  return { participants: participantStats, session: sessionStats }
}

export async function exportAnalyticsCsv(sessionCode: string): Promise<string> {
  const analytics = await getSessionAnalytics(sessionCode)
  return formatAnalyticsCsv(analytics.participants, analytics.session)
}
