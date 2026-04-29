"use server"

import { prisma } from "@/lib/prisma"
import { requireParticipant } from "@/lib/actions/utils"
import { listTranscriptSegments } from "@/lib/transcripts"

/** Creates a legacy transcript row for the authenticated participant. */
export async function createTranscriptSegment(
  sessionId: string,
  content: string,
  timestamp: number,
  duration?: number,
  confidence?: number
) {
  const user = await requireParticipant(sessionId)

  return await prisma.transcript.create({
    data: {
      session_id: sessionId,
      speaker_id: user.id,
      content,
      timestamp,
      duration: duration ?? null,
      confidence: confidence ?? null,
    },
  })
}

/** Returns legacy transcript rows for an active participant in timestamp order. */
export async function getTranscriptBySession(sessionId: string) {
  await requireParticipant(sessionId)

  return await prisma.transcript.findMany({
    where: { session_id: sessionId },
    orderBy: { timestamp: "asc" },
    include: {
      speaker: { select: { id: true, username: true, realname: true } },
    },
  })
}

/** Returns live transcript segments for an active participant. */
export async function getTranscriptSegments(sessionId: string) {
  await requireParticipant(sessionId)

  return listTranscriptSegments(sessionId)
}
