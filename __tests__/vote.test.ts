import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionStatus, VoteType } from '@/lib/generated/prisma'

// ── Mocks ──
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    session: {
      findUnique: vi.fn(),
    },
    participatesIn: {
      findUnique: vi.fn(),
    },
    vote: {
      upsert: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  },
}))

import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { castVote, retractVote, getVoteCounts } from '@/lib/actions/vote'

const MOCK_USER_ID = 'user-uuid-1234'
const MOCK_SESSION_ID = 'session-cuid-5678'
const MOCK_TARGET_USER_ID = 'target-user-uuid'

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

// ── castVote ──
describe('castVote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    ;(prisma.session.findUnique as any).mockResolvedValue({
      id: MOCK_SESSION_ID,
      status: SessionStatus.LIVE,
    })
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: MOCK_USER_ID,
      session_id: MOCK_SESSION_ID,
      left_at: null,
    })
    ;(prisma.vote.upsert as any).mockResolvedValue({})
  })

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(
      castVote(MOCK_SESSION_ID, MOCK_TARGET_USER_ID, VoteType.KICK)
    ).rejects.toThrow('Not authenticated')
  })

  it('throws "Cannot vote for yourself"', async () => {
    await expect(
      castVote(MOCK_SESSION_ID, MOCK_USER_ID, VoteType.KICK)
    ).rejects.toThrow('Cannot vote for yourself')
  })

  it('throws "Session not found"', async () => {
    ;(prisma.session.findUnique as any).mockResolvedValue(null)
    await expect(
      castVote(MOCK_SESSION_ID, MOCK_TARGET_USER_ID, VoteType.KICK)
    ).rejects.toThrow('Session not found')
  })

  it('throws "Session is not live" when status is WAITING', async () => {
    ;(prisma.session.findUnique as any).mockResolvedValue({
      id: MOCK_SESSION_ID,
      status: SessionStatus.WAITING,
    })
    await expect(
      castVote(MOCK_SESSION_ID, MOCK_TARGET_USER_ID, VoteType.KICK)
    ).rejects.toThrow('Session is not live')
  })

  it('throws "Not a participant" when no participation record', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue(null)
    await expect(
      castVote(MOCK_SESSION_ID, MOCK_TARGET_USER_ID, VoteType.KICK)
    ).rejects.toThrow('Not a participant in this session')
  })

  it('throws "Not a participant" when left_at is set', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: MOCK_USER_ID,
      session_id: MOCK_SESSION_ID,
      left_at: new Date(),
    })
    await expect(
      castVote(MOCK_SESSION_ID, MOCK_TARGET_USER_ID, VoteType.KICK)
    ).rejects.toThrow('Not a participant in this session')
  })

  it('calls prisma.vote.upsert with correct compound key on success', async () => {
    await castVote(MOCK_SESSION_ID, MOCK_TARGET_USER_ID, VoteType.KICK)
    expect(prisma.vote.upsert).toHaveBeenCalledWith({
      where: {
        session_id_voter_id_target_user_id_vote_type: {
          session_id: MOCK_SESSION_ID,
          voter_id: MOCK_USER_ID,
          target_user_id: MOCK_TARGET_USER_ID,
          vote_type: VoteType.KICK,
        },
      },
      create: {
        session_id: MOCK_SESSION_ID,
        voter_id: MOCK_USER_ID,
        target_user_id: MOCK_TARGET_USER_ID,
        vote_type: VoteType.KICK,
      },
      update: {},
    })
  })
})

// ── retractVote ──
describe('retractVote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    ;(prisma.vote.delete as any).mockResolvedValue({})
  })

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(
      retractVote(MOCK_SESSION_ID, MOCK_TARGET_USER_ID, VoteType.KICK)
    ).rejects.toThrow('Not authenticated')
  })

  it('calls prisma.vote.delete with correct compound key', async () => {
    await retractVote(MOCK_SESSION_ID, MOCK_TARGET_USER_ID, VoteType.KICK)
    expect(prisma.vote.delete).toHaveBeenCalledWith({
      where: {
        session_id_voter_id_target_user_id_vote_type: {
          session_id: MOCK_SESSION_ID,
          voter_id: MOCK_USER_ID,
          target_user_id: MOCK_TARGET_USER_ID,
          vote_type: VoteType.KICK,
        },
      },
    })
  })
})

// ── getVoteCounts ──
describe('getVoteCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prisma.vote.count as any).mockResolvedValue(5)
  })

  it('calls prisma.vote.count and returns {count}', async () => {
    const result = await getVoteCounts(
      MOCK_SESSION_ID,
      MOCK_TARGET_USER_ID,
      VoteType.KICK
    )
    expect(prisma.vote.count).toHaveBeenCalledWith({
      where: {
        session_id: MOCK_SESSION_ID,
        target_user_id: MOCK_TARGET_USER_ID,
        vote_type: VoteType.KICK,
      },
    })
    expect(result).toEqual({ count: 5 })
  })
})
