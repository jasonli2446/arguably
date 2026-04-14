import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionRole, SessionStatus } from '@/lib/generated/prisma'

// ── Mocks ──
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    session: {
      findUnique: vi.fn(),
    },
    participatesIn: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    audienceQueue: {
      create: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    roleHistory: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import {
  joinQueue,
  leaveQueue,
  getQueue,
  promoteFromQueue,
} from '@/lib/actions/queue'

const MOCK_USER_ID = 'user-uuid-1234'
const MOCK_SESSION_ID = 'session-cuid-5678'
const MOCK_HOST_ID = 'host-uuid'
const MOCK_QUEUE_USER_ID = 'queue-user-uuid'

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

  it('throws when not authenticated', async () => {
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

  it('throws "Not a participant" when no record', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue(null)
    await expect(joinQueue(MOCK_SESSION_ID)).rejects.toThrow(
      'Not a participant in this session'
    )
  })

  it('throws "Only audience members can join the queue" when role is DEBATER', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: MOCK_USER_ID,
      session_id: MOCK_SESSION_ID,
      session_role: SessionRole.DEBATER,
      left_at: null,
    })
    await expect(joinQueue(MOCK_SESSION_ID)).rejects.toThrow(
      'Only audience members can join the queue'
    )
  })

  it('calls prisma.audienceQueue.create on success', async () => {
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
    ;(prisma.audienceQueue.delete as any).mockResolvedValue({})
  })

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(leaveQueue(MOCK_SESSION_ID)).rejects.toThrow('Not authenticated')
  })

  it('calls prisma.audienceQueue.delete with correct compound key', async () => {
    await leaveQueue(MOCK_SESSION_ID)
    expect(prisma.audienceQueue.delete).toHaveBeenCalledWith({
      where: {
        session_id_user_id: {
          session_id: MOCK_SESSION_ID,
          user_id: MOCK_USER_ID,
        },
      },
    })
  })
})

// ── getQueue ──
describe('getQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prisma.audienceQueue.findMany as any).mockResolvedValue([])
  })

  it('calls prisma.audienceQueue.findMany ordered by joined_queue asc', async () => {
    await getQueue(MOCK_SESSION_ID)
    expect(prisma.audienceQueue.findMany).toHaveBeenCalledWith({
      where: { session_id: MOCK_SESSION_ID },
      orderBy: { joined_queue: 'asc' },
      include: {
        user: { select: { id: true, username: true, realname: true } },
      },
    })
  })
})

// ── promoteFromQueue ──
describe('promoteFromQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_HOST_ID)

    // Mock the transaction callback pattern
    const mockTx = {
      audienceQueue: {
        findFirst: vi.fn().mockResolvedValue({
          user_id: MOCK_QUEUE_USER_ID,
          session_id: MOCK_SESSION_ID,
        }),
        findUnique: vi.fn().mockResolvedValue({
          user_id: MOCK_QUEUE_USER_ID,
          session_id: MOCK_SESSION_ID,
        }),
        delete: vi.fn().mockResolvedValue({}),
      },
      participatesIn: {
        update: vi.fn().mockResolvedValue({}),
      },
      roleHistory: {
        create: vi.fn().mockResolvedValue({}),
      },
    }
    ;(prisma.$transaction as any).mockImplementation(async (cb: any) => cb(mockTx))

    // Mock session with host
    ;(prisma.session.findUnique as any).mockResolvedValue({
      id: MOCK_SESSION_ID,
      host_id: MOCK_HOST_ID,
      moderator_id: null,
      host: { id: MOCK_HOST_ID },
      moderator: null,
    })
  })

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(promoteFromQueue(MOCK_SESSION_ID)).rejects.toThrow('Not authenticated')
  })

  it('throws "Not authorized" when user is not host/moderator', async () => {
    mockAuth('other-user-id')
    ;(prisma.session.findUnique as any).mockResolvedValue({
      id: MOCK_SESSION_ID,
      host_id: MOCK_HOST_ID,
      moderator_id: null,
      host: { id: MOCK_HOST_ID },
      moderator: null,
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
      participatesIn: {
        update: vi.fn(),
      },
      roleHistory: {
        create: vi.fn(),
      },
    }
    ;(prisma.$transaction as any).mockImplementation(async (cb: any) => cb(mockTx))

    await expect(promoteFromQueue(MOCK_SESSION_ID)).rejects.toThrow('No one in the queue')
  })

  it('calls $transaction on success', async () => {
    await promoteFromQueue(MOCK_SESSION_ID)
    expect(prisma.$transaction).toHaveBeenCalled()
  })

  it('promotes FIFO user when no userId specified', async () => {
    const mockTx = {
      audienceQueue: {
        findFirst: vi.fn().mockResolvedValue({
          user_id: MOCK_QUEUE_USER_ID,
          session_id: MOCK_SESSION_ID,
        }),
        findUnique: vi.fn(),
        delete: vi.fn().mockResolvedValue({}),
      },
      participatesIn: {
        update: vi.fn().mockResolvedValue({}),
      },
      roleHistory: {
        create: vi.fn().mockResolvedValue({}),
      },
    }
    ;(prisma.$transaction as any).mockImplementation(async (cb: any) => cb(mockTx))

    const result = await promoteFromQueue(MOCK_SESSION_ID)

    expect(mockTx.audienceQueue.findFirst).toHaveBeenCalledWith({
      where: { session_id: MOCK_SESSION_ID },
      orderBy: { joined_queue: 'asc' },
    })
    expect(mockTx.participatesIn.update).toHaveBeenCalledWith({
      where: {
        user_id_session_id: {
          user_id: MOCK_QUEUE_USER_ID,
          session_id: MOCK_SESSION_ID,
        },
      },
      data: { session_role: SessionRole.DEBATER },
    })
    expect(mockTx.audienceQueue.delete).toHaveBeenCalledWith({
      where: {
        session_id_user_id: {
          session_id: MOCK_SESSION_ID,
          user_id: MOCK_QUEUE_USER_ID,
        },
      },
    })
    expect(mockTx.roleHistory.create).toHaveBeenCalledWith({
      data: {
        session_id: MOCK_SESSION_ID,
        user_id: MOCK_QUEUE_USER_ID,
        old_role: SessionRole.AUDIENCE,
        new_role: SessionRole.DEBATER,
        reason: 'Promoted from queue',
      },
    })
    expect(result).toEqual({ promotedUserId: MOCK_QUEUE_USER_ID })
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
      participatesIn: {
        update: vi.fn().mockResolvedValue({}),
      },
      roleHistory: {
        create: vi.fn().mockResolvedValue({}),
      },
    }
    ;(prisma.$transaction as any).mockImplementation(async (cb: any) => cb(mockTx))

    const result = await promoteFromQueue(MOCK_SESSION_ID, specificUserId)

    expect(mockTx.audienceQueue.findUnique).toHaveBeenCalledWith({
      where: { session_id_user_id: { session_id: MOCK_SESSION_ID, user_id: specificUserId } },
    })
    expect(mockTx.participatesIn.update).toHaveBeenCalledWith({
      where: {
        user_id_session_id: {
          user_id: specificUserId,
          session_id: MOCK_SESSION_ID,
        },
      },
      data: { session_role: SessionRole.DEBATER },
    })
    expect(result).toEqual({ promotedUserId: specificUserId })
  })

  it('allows moderator to promote from queue', async () => {
    mockAuth('moderator-uuid')
    ;(prisma.session.findUnique as any).mockResolvedValue({
      id: MOCK_SESSION_ID,
      host_id: MOCK_HOST_ID,
      moderator_id: 'moderator-uuid',
      host: { id: MOCK_HOST_ID },
      moderator: { id: 'moderator-uuid' },
    })

    await promoteFromQueue(MOCK_SESSION_ID)
    expect(prisma.$transaction).toHaveBeenCalled()
  })
})
