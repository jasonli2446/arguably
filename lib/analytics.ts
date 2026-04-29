/**
 * Pure analytics computation functions for debate replay.
 * Separated from server actions for testability.
 */

/** Raw persisted turn log shape used as analytics input. */
export interface TurnLogEntry {
  id: string
  speaker_user_id: string | null
  speaker_name: string
  turn_index: number
  reason: string // TurnReason enum: TIMER_EXPIRED | MANUAL_ADVANCE | SPEAKER_DISCONNECT | DEBATE_START
  started_at: Date
  ended_at: Date
  duration_sec: number
}

/** Raw transcript shape used to compute replay word counts. */
export interface TranscriptEntry {
  id: string
  speaker_id: string
  content: string
  timestamp: number // seconds since debate start
  duration: number | null
}

/** Per-speaker aggregate metrics for an ended debate. */
export interface ParticipantStats {
  speakerId: string
  speakerName: string
  totalSpeakingTime: number // seconds
  turnCount: number
  avgTurnDuration: number // seconds
  longestTurn: number // seconds
  wordsSpoken: number
  speakingTimePercent: number // 0-100
}

/** Session-level aggregate metrics for an ended debate. */
export interface SessionStats {
  debateDuration: number // seconds
  totalTurns: number
  totalWords: number
  debateStartTime: Date | null
  debateEndTime: Date | null
}

/** Turn interval normalized to seconds from debate start for replay timelines. */
export interface NormalizedTurn {
  speakerId: string | null
  speakerName: string
  turnIndex: number
  reason: string
  startOffset: number // seconds from debate start
  endOffset: number // seconds from debate start
  durationSec: number
}

/** Computes duration, turn count, and start/end timestamps from raw turn logs. */
export function computeSessionStats(turnLogs: TurnLogEntry[]): SessionStats {
  if (turnLogs.length === 0) {
    return { debateDuration: 0, totalTurns: 0, totalWords: 0, debateStartTime: null, debateEndTime: null }
  }

  const sorted = [...turnLogs].sort((a, b) => a.started_at.getTime() - b.started_at.getTime())
  const debateStartTime = sorted[0].started_at
  const debateEndTime = sorted[sorted.length - 1].ended_at
  const debateDuration = (debateEndTime.getTime() - debateStartTime.getTime()) / 1000

  // Count meaningful turns (exclude DEBATE_START placeholders with 0 duration)
  const meaningfulTurns = sorted.filter(
    (t) => !(t.reason === 'DEBATE_START' && t.duration_sec === 0)
  )

  return {
    debateDuration: Math.max(0, debateDuration),
    totalTurns: meaningfulTurns.length,
    totalWords: 0, // filled in by caller with transcript data
    debateStartTime,
    debateEndTime,
  }
}

/** Computes per-participant speaking-time and transcript word-count analytics. */
export function computeParticipantStats(
  turnLogs: TurnLogEntry[],
  transcripts: TranscriptEntry[],
  debateDuration: number
): ParticipantStats[] {
  // Group turn logs by speaker (exclude DEBATE_START placeholders and null speakers)
  const meaningfulTurns = turnLogs.filter(
    (t) => t.speaker_user_id !== null && !(t.reason === 'DEBATE_START' && t.duration_sec === 0)
  )

  const speakerMap = new Map<string, { name: string; turns: TurnLogEntry[] }>()

  for (const turn of meaningfulTurns) {
    const id = turn.speaker_user_id!
    if (!speakerMap.has(id)) {
      speakerMap.set(id, { name: turn.speaker_name, turns: [] })
    }
    speakerMap.get(id)!.turns.push(turn)
  }

  // Count words per speaker from transcripts
  const wordCountMap = new Map<string, number>()
  for (const t of transcripts) {
    const words = t.content.trim().split(/\s+/).filter(Boolean).length
    wordCountMap.set(t.speaker_id, (wordCountMap.get(t.speaker_id) ?? 0) + words)
  }

  const stats: ParticipantStats[] = []

  for (const [speakerId, { name, turns }] of speakerMap) {
    const totalSpeakingTime = turns.reduce((sum, t) => sum + t.duration_sec, 0)
    const turnCount = turns.length
    const avgTurnDuration = turnCount > 0 ? totalSpeakingTime / turnCount : 0
    const longestTurn = turns.reduce((max, t) => Math.max(max, t.duration_sec), 0)
    const wordsSpoken = wordCountMap.get(speakerId) ?? 0
    const speakingTimePercent = debateDuration > 0 ? (totalSpeakingTime / debateDuration) * 100 : 0

    stats.push({
      speakerId,
      speakerName: name,
      totalSpeakingTime: Math.round(totalSpeakingTime * 100) / 100,
      turnCount,
      avgTurnDuration: Math.round(avgTurnDuration * 100) / 100,
      longestTurn: Math.round(longestTurn * 100) / 100,
      wordsSpoken,
      speakingTimePercent: Math.round(speakingTimePercent * 10) / 10,
    })
  }

  // Sort by total speaking time descending
  stats.sort((a, b) => b.totalSpeakingTime - a.totalSpeakingTime)
  return stats
}

/** Converts raw turn logs into replay-friendly offsets from the debate start timestamp. */
export function normalizeTurnLogs(
  turnLogs: TurnLogEntry[],
  debateStartTime: Date
): NormalizedTurn[] {
  const startMs = debateStartTime.getTime()

  return turnLogs
    .sort((a, b) => a.started_at.getTime() - b.started_at.getTime())
    .map((t) => ({
      speakerId: t.speaker_user_id,
      speakerName: t.speaker_name,
      turnIndex: t.turn_index,
      reason: t.reason,
      startOffset: Math.max(0, (t.started_at.getTime() - startMs) / 1000),
      endOffset: Math.max(0, (t.ended_at.getTime() - startMs) / 1000),
      durationSec: t.duration_sec,
    }))
}

/** Formats participant and session analytics as a CSV export string. */
export function formatAnalyticsCsv(
  participantStats: ParticipantStats[],
  sessionStats: SessionStats
): string {
  const headers = [
    'participant_name',
    'total_speaking_time_s',
    'turn_count',
    'avg_turn_duration_s',
    'longest_turn_s',
    'words_spoken',
    'speaking_time_pct',
  ]

  const rows = participantStats.map((p) => [
    escapeCsvField(p.speakerName),
    p.totalSpeakingTime.toString(),
    p.turnCount.toString(),
    p.avgTurnDuration.toString(),
    p.longestTurn.toString(),
    p.wordsSpoken.toString(),
    p.speakingTimePercent.toString(),
  ])

  // Add session summary row
  rows.push([
    'SESSION TOTAL',
    sessionStats.debateDuration.toString(),
    sessionStats.totalTurns.toString(),
    '',
    '',
    sessionStats.totalWords.toString(),
    '100',
  ])

  const lines = [headers.join(','), ...rows.map((r) => r.join(','))]
  return lines.join('\n') + '\n'
}

function escapeCsvField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}
