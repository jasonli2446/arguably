import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    participatesIn: {
      findUnique: vi.fn(),
    },
    transcript: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import {
  createTranscriptSegment,
  getTranscriptBySession,
} from '@/lib/actions/transcript'

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
  if (userId) {
    ;(prisma.user.findUnique as any).mockResolvedValue({
      banned_at: null,
      suspended_until: null,
      deleted_at: null,
    })
  }
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
