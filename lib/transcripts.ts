import { prisma } from "@/lib/prisma"

/** Client-safe transcript segment emitted by live transcription and replay views. */
export interface TranscriptSegmentView {
  id: string
  sessionId: string
  speakerId: string
  speakerName: string
  text: string
  chunkIndex: number
  startedAt: string
  endedAt: string
  isFinal: boolean
  provider: string
  providerModel: string
  createdAt: string
}

/** Input required to upsert one live transcript segment. */
export interface SaveTranscriptSegmentInput {
  sessionId: string
  speakerId: string
  speakerName: string
  text: string
  chunkIndex: number
  startedAt: Date
  endedAt: Date
  provider: string
  providerModel: string
}

function toTranscriptView(segment: {
  id: string
  session_id: string
  speaker_id: string
  speaker_name: string
  text: string
  chunk_index: number
  started_at: Date
  ended_at: Date
  is_final: boolean
  provider: string
  provider_model: string
  created_at: Date
}): TranscriptSegmentView {
  return {
    id: segment.id,
    sessionId: segment.session_id,
    speakerId: segment.speaker_id,
    speakerName: segment.speaker_name,
    text: segment.text,
    chunkIndex: segment.chunk_index,
    startedAt: segment.started_at.toISOString(),
    endedAt: segment.ended_at.toISOString(),
    isFinal: segment.is_final,
    provider: segment.provider,
    providerModel: segment.provider_model,
    createdAt: segment.created_at.toISOString(),
  }
}

/** Lists transcript segments for a session in spoken-time order. */
export async function listTranscriptSegments(sessionId: string): Promise<TranscriptSegmentView[]> {
  const segments = await prisma.transcriptSegment.findMany({
    where: { session_id: sessionId },
    orderBy: [
      { started_at: "asc" },
      { created_at: "asc" },
    ],
  })

  return segments.map(toTranscriptView)
}

/** Upserts one transcript segment by session, speaker, and chunk index. */
export async function saveTranscriptSegment(input: SaveTranscriptSegmentInput): Promise<TranscriptSegmentView> {
  const segment = await prisma.transcriptSegment.upsert({
    where: {
      session_id_speaker_id_chunk_index: {
        session_id: input.sessionId,
        speaker_id: input.speakerId,
        chunk_index: input.chunkIndex,
      },
    },
    create: {
      session_id: input.sessionId,
      speaker_id: input.speakerId,
      speaker_name: input.speakerName,
      text: input.text,
      chunk_index: input.chunkIndex,
      started_at: input.startedAt,
      ended_at: input.endedAt,
      provider: input.provider,
      provider_model: input.providerModel,
      is_final: true,
    },
    update: {
      speaker_name: input.speakerName,
      text: input.text,
      started_at: input.startedAt,
      ended_at: input.endedAt,
      provider: input.provider,
      provider_model: input.providerModel,
      is_final: true,
    },
  })

  return toTranscriptView(segment)
}
