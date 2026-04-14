import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionRole, SessionStatus, VoteType } from '@/lib/generated/prisma'

// ── Mocks ──
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    participatesIn: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    session: { findUnique: vi.fn() },
    audienceQueue: {
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    vote: {
      create: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
    roleHistory: {
      create: vi.fn(),
    },
    debateState: { findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn((fn) => fn({
      participatesIn: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
      session: { findUnique: vi.fn() },
      audienceQueue: {
        create: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
      vote: {
        create: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn(),
        deleteMany: vi.fn(),
      },
      roleHistory: {
        create: vi.fn(),
      },
      debateState: { findUnique: vi.fn(), update: vi.fn() },
    })),
  },
}))

import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import {
  joinQueue,
  leaveQueue,
  getQueue,
  promoteFromQueue,
  castKickVote,
  removeKickVote,
  getKickVotes,
} from '@/lib/actions/queue'

const MOCK_USER_ID = 'user-uuid-1234'
const MOCK_SESSION_ID = 'session-cuid-5678'
const MOCK_TARGET_USER_ID = 'target-user-uuid'
const MOCK_HOST_ID = 'host-uuid'

function mockAuth(userId: string | null) {
  ;(createClient as any).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  })
}

// ── joinQueue ──
describe('joinQueue', () => {
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
      session_role: SessionRole.AUDIENCE,
      left_at: null,
    })
    ;(prisma.audienceQueue.create as any).mockResolvedValue({})
  })

  it('throws if not authenticated', async () => {
    mockAuth(null)
    await expect(joinQueue(MOCK_SESSION_ID)).rejects.toThrow('Not authenticated')
  })

  it('throws "Session not found"', async () => {
    ;(prisma.session.findUnique as any).mockResolvedValue(null)
    await expect(joinQueue(MOCK_SESSION_ID)).rejects.toThrow('Session not found')
  })

  it('throws "Session is not live"', async () => {
    ;(prisma.session.findUnique as any).mockResolvedValue({
      id: MOCK_SESSION_ID,
      status: SessionStatus.WAITING,
    })
    await expect(joinQueue(MOCK_SESSION_ID)).rejects.toThrow('Session is not live')
  })

  it('throws if not a participant (findUnique returns null)', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue(null)
    await expect(joinQueue(MOCK_SESSION_ID)).rejects.toThrow('Not a participant in this session')
  })

  it('throws if left session (left_at is set)', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: MOCK_USER_ID,
      session_id: MOCK_SESSION_ID,
      session_role: SessionRole.AUDIENCE,
      left_at: new Date(),
    })
    await expect(joinQueue(MOCK_SESSION_ID)).rejects.toThrow('Not a participant in this session')
  })

  it('throws if not AUDIENCE role (HOST)', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: MOCK_USER_ID,
      session_id: MOCK_SESSION_ID,
      session_role: SessionRole.HOST,
      left_at: null,
    })
    await expect(joinQueue(MOCK_SESSION_ID)).rejects.toThrow('Only audience members can join the queue')
  })

  it('throws if not AUDIENCE role (DEBATER)', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: MOCK_USER_ID,
      session_id: MOCK_SESSION_ID,
      session_role: SessionRole.DEBATER,
      left_at: null,
    })
    await expect(joinQueue(MOCK_SESSION_ID)).rejects.toThrow('Only audience members can join the queue')
  })

  it('creates AudienceQueue entry on success', async () => {
    await joinQueue(MOCK_SESSION_ID)
    expect(prisma.audienceQueue.create).toHaveBeenCalledWith({
      data: {
        session_id: MOCK_SESSION_ID,
        user_id: MOCK_USER_ID,
      },
    })
  })
})

// ── leaveQueue ──
describe('leaveQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
  })

  it('throws if not authenticated', async () => {
    mockAuth(null)
    await expect(leaveQueue(MOCK_SESSION_ID)).rejects.toThrow('Not authenticated')
  })

  it('deletes queue entry and voters votes in a transaction', async () => {
    const mockTx = {
      audienceQueue: { deleteMany: vi.fn().mockResolvedValue({}) },
      vote: { deleteMany: vi.fn().mockResolvedValue({}) },
    }
    ;(prisma.$transaction as any).mockImplementation(async (fn: any) => fn(mockTx))

    await leaveQueue(MOCK_SESSION_ID)

    expect(mockTx.audienceQueue.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          session_id: MOCK_SESSION_ID,
          user_id: MOCK_USER_ID,
        }),
      })
    )
    expect(mockTx.vote.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          session_id: MOCK_SESSION_ID,
          voter_id: MOCK_USER_ID,
        }),
      })
    )
  })
})

// ── getQueue ──
describe('getQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
  })

  it('throws if not authenticated', async () => {
    mockAuth(null)
    await expect(getQueue(MOCK_SESSION_ID)).rejects.toThrow('Not authenticated')
  })

  it('returns entries with computed rank (1-indexed)', async () => {
    ;(prisma.audienceQueue.findMany as any).mockResolvedValue([
      {
        id: 'entry-1',
        user_id: 'user-1',
        session_id: MOCK_SESSION_ID,
        joined_queue: new Date('2026-04-14T10:00:00Z'),
        user: { id: 'user-1', username: 'alice', realname: 'Alice Smith' },
      },
      {
        id: 'entry-2',
        user_id: 'user-2',
        session_id: MOCK_SESSION_ID,
        joined_queue: new Date('2026-04-14T10:05:00Z'),
        user: { id: 'user-2', username: 'bob', realname: null },
      },
      {
        id: 'entry-3',
        user_id: 'user-3',
        session_id: MOCK_SESSION_ID,
        joined_queue: new Date('2026-04-14T10:10:00Z'),
        user: { id: 'user-3', username: 'charlie', realname: 'Charlie Brown' },
      },
    ])

    const result = await getQueue(MOCK_SESSION_ID)

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({
      id: 'entry-1',
      userId: 'user-1',
      rank: 1,
      displayName: 'Alice Smith',
      addedAt: '2026-04-14T10:00:00.000Z',
    })
    expect(result[1]).toEqual({
      id: 'entry-2',
      userId: 'user-2',
      rank: 2,
      displayName: 'bob',
      addedAt: '2026-04-14T10:05:00.000Z',
    })
    expect(result[2]).toEqual({
      id: 'entry-3',
      userId: 'user-3',
      rank: 3,
      displayName: 'Charlie Brown',
      addedAt: '2026-04-14T10:10:00.000Z',
    })
  })

  it('returns empty array when no entries', async () => {
    ;(prisma.audienceQueue.findMany as any).mockResolvedValue([])

    const result = await getQueue(MOCK_SESSION_ID)

    expect(result).toEqual([])
  })
})

// ── promoteFromQueue ──
describe('promoteFromQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_HOST_ID)

    // Mock session with host
    ;(prisma.session.findUnique as any).mockResolvedValue({
      id: MOCK_SESSION_ID,
      host_id: MOCK_HOST_ID,
      moderator_id: null,
    })
  })

  it('throws if not authenticated', async () => {
    mockAuth(null)
    await expect(promoteFromQueue(MOCK_SESSION_ID)).rejects.toThrow('Not authenticated')
  })

  it('throws if not host or moderator', async () => {
    ;(prisma.session.findUnique as any).mockResolvedValue({
      id: MOCK_SESSION_ID,
      host_id: 'other-user',
      moderator_id: 'another-user',
    })
    await expect(promoteFromQueue(MOCK_SESSION_ID)).rejects.toThrow('Not authorized')
  })

  it('throws "No one in the queue" when queue is empty', async () => {
    const mockTx = {
      audienceQueue: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn(),
        delete: vi.fn(),
      },
      participatesIn: { update: vi.fn() },
      roleHistory: { create: vi.fn() },
      debateState: { findUnique: vi.fn().mockResolvedValue(null) },
    }
    ;(prisma.$transaction as any).mockImplementation(async (fn: any) => fn(mockTx))

    await expect(promoteFromQueue(MOCK_SESSION_ID)).rejects.toThrow('No one in the queue')
  })

  it('calls $transaction and returns promoted user on FIFO promote', async () => {
    const mockTx = {
      audienceQueue: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'queue-entry-1',
          session_id: MOCK_SESSION_ID,
          user_id: 'promoted-user',
          joined_queue: new Date(),
          user: { id: 'promoted-user', username: 'promoted', realname: 'Promoted User' },
        }),
        delete: vi.fn().mockResolvedValue({}),
      },
      participatesIn: { update: vi.fn().mockResolvedValue({}) },
      debateState: { findUnique: vi.fn().mockResolvedValue(null) },
      roleHistory: { create: vi.fn().mockResolvedValue({}) },
    }
    ;(prisma.$transaction as any).mockImplementation(async (fn: any) => fn(mockTx))

    const result = await promoteFromQueue(MOCK_SESSION_ID)

    expect(result).toEqual({
      promotedUserId: 'promoted-user',
    })
    expect(mockTx.audienceQueue.delete).toHaveBeenCalled()
    expect(mockTx.participatesIn.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id_session_id: {
            user_id: 'promoted-user',
            session_id: MOCK_SESSION_ID,
          },
        }),
        data: expect.objectContaining({ session_role: SessionRole.DEBATER }),
      })
    )
  })

  it('promotes specific user when userId is provided', async () => {
    const specificUserId = 'specific-user-uuid'
    const mockTx = {
      audienceQueue: {
        findFirst: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          user_id: specificUserId,
          session_id: MOCK_SESSION_ID,
        }),
        delete: vi.fn().mockResolvedValue({}),
      },
      participatesIn: { update: vi.fn().mockResolvedValue({}) },
      roleHistory: { create: vi.fn().mockResolvedValue({}) },
    }
    ;(prisma.$transaction as any).mockImplementation(async (fn: any) => fn(mockTx))

    const result = await promoteFromQueue(MOCK_SESSION_ID, specificUserId)

    expect(mockTx.audienceQueue.findUnique).toHaveBeenCalledWith({
      where: { session_id_user_id: { session_id: MOCK_SESSION_ID, user_id: specificUserId } },
    })
    expect(result).toEqual({ promotedUserId: specificUserId })
  })

  it('allows moderator to promote from queue', async () => {
    mockAuth('moderator-uuid')
    ;(prisma.session.findUnique as any).mockResolvedValue({
      id: MOCK_SESSION_ID,
      host_id: MOCK_HOST_ID,
      moderator_id: 'moderator-uuid',
    })

    const mockTx = {
      audienceQueue: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'queue-entry',
          session_id: MOCK_SESSION_ID,
          user_id: 'some-user',
          joined_queue: new Date(),
          user: { id: 'some-user', username: 'someone', realname: null },
        }),
        delete: vi.fn().mockResolvedValue({}),
      },
      participatesIn: { update: vi.fn().mockResolvedValue({}) },
      debateState: { findUnique: vi.fn().mockResolvedValue(null) },
      roleHistory: { create: vi.fn().mockResolvedValue({}) },
    }
    ;(prisma.$transaction as any).mockImplementation(async (fn: any) => fn(mockTx))

    await promoteFromQueue(MOCK_SESSION_ID)
    expect(prisma.$transaction).toHaveBeenCalled()
  })
})

// ── castKickVote ──
describe('castKickVote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
  })

  it('throws if not authenticated', async () => {
    mockAuth(null)
    await expect(castKickVote(MOCK_SESSION_ID, MOCK_TARGET_USER_ID)).rejects.toThrow('Not authenticated')
  })

  it('throws if voting to kick yourself', async () => {
    await expect(castKickVote(MOCK_SESSION_ID, MOCK_USER_ID)).rejects.toThrow('Cannot vote to kick yourself')
  })

  it('throws if voter is not AUDIENCE', async () => {
    const mockTx = {
      participatesIn: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({
            user_id: MOCK_USER_ID,
            session_id: MOCK_SESSION_ID,
            session_role: SessionRole.DEBATER,
            left_at: null,
          }),
      },
    }
    ;(prisma.$transaction as any).mockImplementation(async (fn: any) => fn(mockTx))

    await expect(castKickVote(MOCK_SESSION_ID, MOCK_TARGET_USER_ID)).rejects.toThrow('Only audience members can vote to kick')
  })

  it('throws if target is not DEBATER', async () => {
    const mockTx = {
      participatesIn: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({
            user_id: MOCK_USER_ID,
            session_id: MOCK_SESSION_ID,
            session_role: SessionRole.AUDIENCE,
            left_at: null,
          })
          .mockResolvedValueOnce({
            user_id: MOCK_TARGET_USER_ID,
            session_id: MOCK_SESSION_ID,
            session_role: SessionRole.AUDIENCE,
            left_at: null,
          }),
      },
    }
    ;(prisma.$transaction as any).mockImplementation(async (fn: any) => fn(mockTx))

    await expect(castKickVote(MOCK_SESSION_ID, MOCK_TARGET_USER_ID)).rejects.toThrow('Target must be an active debater')
  })

  it('throws if target is HOST', async () => {
    const mockTx = {
      participatesIn: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({
            user_id: MOCK_USER_ID,
            session_id: MOCK_SESSION_ID,
            session_role: SessionRole.AUDIENCE,
            left_at: null,
          })
          .mockResolvedValueOnce({
            user_id: MOCK_TARGET_USER_ID,
            session_id: MOCK_SESSION_ID,
            session_role: SessionRole.DEBATER,
            left_at: null,
          }),
      },
      session: {
        findUnique: vi.fn().mockResolvedValue({
          id: MOCK_SESSION_ID,
          kick_threshold: 50,
          host_id: MOCK_TARGET_USER_ID,
        }),
      },
    }
    ;(prisma.$transaction as any).mockImplementation(async (fn: any) => fn(mockTx))

    await expect(castKickVote(MOCK_SESSION_ID, MOCK_TARGET_USER_ID)).rejects.toThrow('Cannot vote to kick the host')
  })

  it('creates vote on success', async () => {
    const mockTx = {
      participatesIn: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({
            user_id: MOCK_USER_ID,
            session_id: MOCK_SESSION_ID,
            session_role: SessionRole.AUDIENCE,
            left_at: null,
          })
          .mockResolvedValueOnce({
            user_id: MOCK_TARGET_USER_ID,
            session_id: MOCK_SESSION_ID,
            session_role: SessionRole.DEBATER,
            left_at: null,
          }),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(5),
      },
      session: {
        findUnique: vi.fn().mockResolvedValue({
          id: MOCK_SESSION_ID,
          kick_threshold: 50,
          host_id: 'host-user',
        }),
      },
      vote: {
        create: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(2),
        deleteMany: vi.fn().mockResolvedValue({}),
      },
      roleHistory: { create: vi.fn().mockResolvedValue({}) },
      debateState: { findUnique: vi.fn().mockResolvedValue(null) },
      audienceQueue: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    }
    ;(prisma.$transaction as any).mockImplementation(async (fn: any) => fn(mockTx))

    const result = await castKickVote(MOCK_SESSION_ID, MOCK_TARGET_USER_ID)

    expect(mockTx.vote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          session_id: MOCK_SESSION_ID,
          voter_id: MOCK_USER_ID,
          target_user_id: MOCK_TARGET_USER_ID,
          vote_type: VoteType.KICK,
        }),
      })
    )
    expect(result).toEqual({ kicked: false, voteCount: 2, requiredVotes: 3 })
  })

  it('returns kicked=true when threshold met (with correct math: ceil(audienceCount * threshold / 100))', async () => {
    const mockTx = {
      participatesIn: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({
            user_id: MOCK_USER_ID,
            session_id: MOCK_SESSION_ID,
            session_role: SessionRole.AUDIENCE,
            left_at: null,
          })
          .mockResolvedValueOnce({
            user_id: MOCK_TARGET_USER_ID,
            session_id: MOCK_SESSION_ID,
            session_role: SessionRole.DEBATER,
            left_at: null,
          }),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(5),
      },
      session: {
        findUnique: vi.fn().mockResolvedValue({
          id: MOCK_SESSION_ID,
          kick_threshold: 50,
          host_id: 'host-user',
        }),
      },
      vote: {
        create: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(3),
        deleteMany: vi.fn().mockResolvedValue({}),
      },
      roleHistory: { create: vi.fn().mockResolvedValue({}) },
      debateState: {
        findUnique: vi.fn().mockResolvedValue({
          session_id: MOCK_SESSION_ID,
          debater_order: [
            { userId: 'other-debater', displayName: 'Other' },
            { userId: MOCK_TARGET_USER_ID, displayName: 'Target' },
          ],
          current_index: 0,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      audienceQueue: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    }
    ;(prisma.$transaction as any).mockImplementation(async (fn: any) => fn(mockTx))

    // audienceCount=5, threshold=50 -> requiredVotes = ceil(5 * 50 / 100) = ceil(2.5) = 3
    // voteCount=3 -> kicked=true
    const result = await castKickVote(MOCK_SESSION_ID, MOCK_TARGET_USER_ID)

    expect(result).toEqual({ kicked: true, voteCount: 3, requiredVotes: 3 })
    expect(mockTx.participatesIn.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id_session_id: {
            user_id: MOCK_TARGET_USER_ID,
            session_id: MOCK_SESSION_ID,
          },
        }),
        data: expect.objectContaining({ left_at: expect.any(Date) }),
      })
    )
  })

  it('returns kicked=false when threshold not met', async () => {
    const mockTx = {
      participatesIn: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({
            user_id: MOCK_USER_ID,
            session_id: MOCK_SESSION_ID,
            session_role: SessionRole.AUDIENCE,
            left_at: null,
          })
          .mockResolvedValueOnce({
            user_id: MOCK_TARGET_USER_ID,
            session_id: MOCK_SESSION_ID,
            session_role: SessionRole.DEBATER,
            left_at: null,
          }),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(10),
      },
      session: {
        findUnique: vi.fn().mockResolvedValue({
          id: MOCK_SESSION_ID,
          kick_threshold: 60,
          host_id: 'host-user',
        }),
      },
      vote: {
        create: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(5),
        deleteMany: vi.fn().mockResolvedValue({}),
      },
      roleHistory: { create: vi.fn().mockResolvedValue({}) },
      debateState: { findUnique: vi.fn().mockResolvedValue(null) },
      audienceQueue: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    }
    ;(prisma.$transaction as any).mockImplementation(async (fn: any) => fn(mockTx))

    // audienceCount=10, threshold=60 -> requiredVotes = ceil(10 * 60 / 100) = ceil(6) = 6
    // voteCount=5 -> kicked=false
    const result = await castKickVote(MOCK_SESSION_ID, MOCK_TARGET_USER_ID)

    expect(result).toEqual({ kicked: false, voteCount: 5, requiredVotes: 6 })
    expect(mockTx.participatesIn.update).not.toHaveBeenCalled()
  })
})

// ── removeKickVote ──
describe('removeKickVote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
  })

  it('throws if not authenticated', async () => {
    mockAuth(null)
    await expect(removeKickVote(MOCK_SESSION_ID, MOCK_TARGET_USER_ID)).rejects.toThrow('Not authenticated')
  })

  it('deletes the vote', async () => {
    ;(prisma.vote.deleteMany as any).mockResolvedValue({})

    await removeKickVote(MOCK_SESSION_ID, MOCK_TARGET_USER_ID)

    expect(prisma.vote.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          session_id: MOCK_SESSION_ID,
          voter_id: MOCK_USER_ID,
          target_user_id: MOCK_TARGET_USER_ID,
          vote_type: VoteType.KICK,
        }),
      })
    )
  })
})

// ── getKickVotes ──
describe('getKickVotes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
  })

  it('throws if not authenticated', async () => {
    mockAuth(null)
    await expect(getKickVotes(MOCK_SESSION_ID, MOCK_TARGET_USER_ID)).rejects.toThrow('Not authenticated')
  })

  it('returns correct voteCount, requiredVotes, userHasVoted', async () => {
    ;(prisma.vote.count as any).mockResolvedValue(3)
    ;(prisma.participatesIn.count as any).mockResolvedValue(8)
    ;(prisma.vote.findFirst as any).mockResolvedValue({ id: 'vote-1' })
    ;(prisma.session.findUnique as any).mockResolvedValue({ kick_threshold: 50 })

    const result = await getKickVotes(MOCK_SESSION_ID, MOCK_TARGET_USER_ID)

    // audienceCount=8, threshold=50 -> requiredVotes = ceil(8 * 50 / 100) = ceil(4) = 4
    expect(result).toEqual({
      voteCount: 3,
      requiredVotes: 4,
      userHasVoted: true,
    })
  })

  it('returns userHasVoted=false when user has not voted', async () => {
    ;(prisma.vote.count as any).mockResolvedValue(2)
    ;(prisma.participatesIn.count as any).mockResolvedValue(10)
    ;(prisma.vote.findFirst as any).mockResolvedValue(null)
    ;(prisma.session.findUnique as any).mockResolvedValue({ kick_threshold: 60 })

    const result = await getKickVotes(MOCK_SESSION_ID, MOCK_TARGET_USER_ID)

    // audienceCount=10, threshold=60 -> requiredVotes = ceil(10 * 60 / 100) = ceil(6) = 6
    expect(result).toEqual({
      voteCount: 2,
      requiredVotes: 6,
      userHasVoted: false,
    })
  })
})
