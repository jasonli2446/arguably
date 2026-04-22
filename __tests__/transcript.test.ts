import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    participatesIn: {
      findUnique: vi.fn(),
    },
    transcript: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    transcriptSegment: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}))

import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import {
  createTranscriptSegment,
  getTranscriptBySession,
  getTranscriptSegments,
} from '@/lib/actions/transcript'
import { listTranscriptSegments, saveTranscriptSegment } from '@/lib/transcripts'

const MOCK_USER_ID = 'user-uuid-1234'
const MOCK_SESSION_ID = 'session-cuid-5678'

// Helper to set up auth mock
function mockAuth(userId: string | null) {
  ;(createClient as any).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  })
}

// ── createTranscriptSegment ──
describe('createTranscriptSegment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: MOCK_USER_ID,
      session_id: MOCK_SESSION_ID,
      left_at: null,
    })
    ;(prisma.transcript.create as any).mockResolvedValue({
      id: 'transcript-id',
    })
  })

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(
      createTranscriptSegment(MOCK_SESSION_ID, 'Test content', 1000)
    ).rejects.toThrow('Not authenticated')
  })

  it('throws "Not a participant" when no participation', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue(null)
    await expect(
      createTranscriptSegment(MOCK_SESSION_ID, 'Test content', 1000)
    ).rejects.toThrow('Not a participant in this session')
  })

  it('throws "Not a participant" when left_at is set', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: MOCK_USER_ID,
      session_id: MOCK_SESSION_ID,
      left_at: new Date(),
    })
    await expect(
      createTranscriptSegment(MOCK_SESSION_ID, 'Test content', 1000)
    ).rejects.toThrow('Not a participant in this session')
  })

  it('calls prisma.transcript.create with correct data on success', async () => {
    await createTranscriptSegment(MOCK_SESSION_ID, 'Test content', 1000, 5, 0.95)
    expect(prisma.transcript.create).toHaveBeenCalledWith({
      data: {
        session_id: MOCK_SESSION_ID,
        speaker_id: MOCK_USER_ID,
        content: 'Test content',
        timestamp: 1000,
        duration: 5,
        confidence: 0.95,
      },
    })
  })

  it('calls prisma.transcript.create with null for optional duration/confidence', async () => {
    await createTranscriptSegment(MOCK_SESSION_ID, 'Test content', 1000)
    expect(prisma.transcript.create).toHaveBeenCalledWith({
      data: {
        session_id: MOCK_SESSION_ID,
        speaker_id: MOCK_USER_ID,
        content: 'Test content',
        timestamp: 1000,
        duration: null,
        confidence: null,
      },
    })
  })
})

// ── getTranscriptBySession ──
describe('getTranscriptBySession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: MOCK_USER_ID,
      session_id: MOCK_SESSION_ID,
      left_at: null,
    })
    ;(prisma.transcript.findMany as any).mockResolvedValue([])
  })

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(getTranscriptBySession(MOCK_SESSION_ID)).rejects.toThrow('Not authenticated')
  })

  it('throws "Not a participant"', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue(null)
    await expect(getTranscriptBySession(MOCK_SESSION_ID)).rejects.toThrow('Not a participant in this session')
  })

  it('calls prisma.transcript.findMany ordered by timestamp asc, with speaker include', async () => {
    await getTranscriptBySession(MOCK_SESSION_ID)
    expect(prisma.transcript.findMany).toHaveBeenCalledWith({
      where: { session_id: MOCK_SESSION_ID },
      orderBy: { timestamp: 'asc' },
      include: {
        speaker: { select: { id: true, username: true, realname: true } },
      },
    })
  })
})

// ── getTranscriptSegments (new live transcription action) ──
describe('getTranscriptSegments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: MOCK_USER_ID,
      session_id: MOCK_SESSION_ID,
      left_at: null,
    })
    ;(prisma.transcriptSegment.findMany as any).mockResolvedValue([])
  })

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(getTranscriptSegments(MOCK_SESSION_ID)).rejects.toThrow('Not authenticated')
  })

  it('throws when not a participant', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue(null)
    await expect(getTranscriptSegments(MOCK_SESSION_ID)).rejects.toThrow('Not a participant in this session')
  })

  it('returns mapped transcript segments for authenticated participants', async () => {
    const createdAt = new Date('2026-04-05T22:10:00.000Z')
    const startedAt = new Date('2026-04-05T22:09:55.000Z')
    const endedAt = new Date('2026-04-05T22:09:58.000Z')

    ;(prisma.transcriptSegment.findMany as any).mockResolvedValue([
      {
        id: 'segment-1',
        session_id: MOCK_SESSION_ID,
        speaker_id: MOCK_USER_ID,
        speaker_name: 'Alice',
        text: 'Opening statement.',
        chunk_index: 3,
        started_at: startedAt,
        ended_at: endedAt,
        is_final: true,
        provider: 'openai',
        provider_model: 'gpt-4o-mini-transcribe',
        created_at: createdAt,
      },
    ])

    const result = await getTranscriptSegments(MOCK_SESSION_ID)

    expect(prisma.transcriptSegment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { session_id: MOCK_SESSION_ID },
      }),
    )
    expect(result).toEqual([
      {
        id: 'segment-1',
        sessionId: MOCK_SESSION_ID,
        speakerId: MOCK_USER_ID,
        speakerName: 'Alice',
        text: 'Opening statement.',
        chunkIndex: 3,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        isFinal: true,
        provider: 'openai',
        providerModel: 'gpt-4o-mini-transcribe',
        createdAt: createdAt.toISOString(),
      },
    ])
  })
})

// ── transcript segment helpers ──
describe('transcript segment helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists transcript segments in chronological order', async () => {
    ;(prisma.transcriptSegment.findMany as any).mockResolvedValue([])

    await listTranscriptSegments(MOCK_SESSION_ID)

    expect(prisma.transcriptSegment.findMany).toHaveBeenCalledWith({
      where: { session_id: MOCK_SESSION_ID },
      orderBy: [
        { started_at: 'asc' },
        { created_at: 'asc' },
      ],
    })
  })

  it('upserts transcript segments by speaker and chunk index', async () => {
    const startedAt = new Date('2026-04-05T22:09:55.000Z')
    const endedAt = new Date('2026-04-05T22:09:58.000Z')
    const createdAt = new Date('2026-04-05T22:10:00.000Z')

    ;(prisma.transcriptSegment.upsert as any).mockResolvedValue({
      id: 'segment-1',
      session_id: MOCK_SESSION_ID,
      speaker_id: MOCK_USER_ID,
      speaker_name: 'Alice',
      text: 'Opening statement.',
      chunk_index: 3,
      started_at: startedAt,
      ended_at: endedAt,
      is_final: true,
      provider: 'openai',
      provider_model: 'gpt-4o-mini-transcribe',
      created_at: createdAt,
    })

    const result = await saveTranscriptSegment({
      sessionId: MOCK_SESSION_ID,
      speakerId: MOCK_USER_ID,
      speakerName: 'Alice',
      text: 'Opening statement.',
      chunkIndex: 3,
      startedAt,
      endedAt,
      provider: 'openai',
      providerModel: 'gpt-4o-mini-transcribe',
    })

    expect(prisma.transcriptSegment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          session_id_speaker_id_chunk_index: {
            session_id: MOCK_SESSION_ID,
            speaker_id: MOCK_USER_ID,
            chunk_index: 3,
          },
        },
      }),
    )
    expect(result.speakerName).toBe('Alice')
    expect(result.chunkIndex).toBe(3)
  })
})
