import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest'

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
  },
}))

import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, requireHostOrModerator, requireParticipant } from '@/lib/actions/utils'

function mockAuth(user: { id: string } | null) {
  ;(createClient as MockInstance).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
      }),
    },
  })
}

const MOCK_USER_ID = 'user-uuid-1234'
const MOCK_SESSION_ID = 'session-cuid-5678'

describe('requireAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws "Not authenticated" when no user', async () => {
    mockAuth(null)
    await expect(requireAuth()).rejects.toThrow('Not authenticated')
  })

  it('returns user when authenticated', async () => {
    const mockUser = { id: MOCK_USER_ID }
    mockAuth(mockUser)
    ;(prisma.user.findUnique as MockInstance).mockResolvedValue({
      banned_at: null,
      suspended_until: null,
      deleted_at: null,
    })
    const result = await requireAuth()
    expect(result).toEqual(mockUser)
  })
})

describe('requireHostOrModerator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(requireHostOrModerator(MOCK_SESSION_ID)).rejects.toThrow('Not authenticated')
  })

  it('throws "Session not found" when session does not exist', async () => {
    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.findUnique as MockInstance).mockResolvedValue({
      banned_at: null,
      suspended_until: null,
      deleted_at: null,
    })
    ;(prisma.session.findUnique as MockInstance).mockResolvedValue(null)
    await expect(requireHostOrModerator(MOCK_SESSION_ID)).rejects.toThrow('Session not found')
  })

  it('throws "Not authorized" when user is neither host nor moderator', async () => {
    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.findUnique as MockInstance).mockResolvedValue({
      banned_at: null,
      suspended_until: null,
      deleted_at: null,
    })
    ;(prisma.session.findUnique as MockInstance).mockResolvedValue({
      id: MOCK_SESSION_ID,
      host_id: 'other-user-1',
      moderator_id: 'other-user-2',
    })
    await expect(requireHostOrModerator(MOCK_SESSION_ID)).rejects.toThrow('Not authorized')
  })

  it('returns {user, session} when user is host', async () => {
    const mockUser = { id: MOCK_USER_ID }
    const mockSession = {
      id: MOCK_SESSION_ID,
      host_id: MOCK_USER_ID,
      moderator_id: null,
    }
    mockAuth(mockUser)
    ;(prisma.user.findUnique as MockInstance).mockResolvedValue({
      banned_at: null,
      suspended_until: null,
      deleted_at: null,
    })
    ;(prisma.session.findUnique as MockInstance).mockResolvedValue(mockSession)

    const result = await requireHostOrModerator(MOCK_SESSION_ID)

    expect(result).toEqual({
      user: mockUser,
      session: mockSession,
    })
  })

  it('returns {user, session} when user is moderator', async () => {
    const mockUser = { id: MOCK_USER_ID }
    const mockSession = {
      id: MOCK_SESSION_ID,
      host_id: 'some-other-user',
      moderator_id: MOCK_USER_ID,
    }
    mockAuth(mockUser)
    ;(prisma.user.findUnique as MockInstance).mockResolvedValue({
      banned_at: null,
      suspended_until: null,
      deleted_at: null,
    })
    ;(prisma.session.findUnique as MockInstance).mockResolvedValue(mockSession)

    const result = await requireHostOrModerator(MOCK_SESSION_ID)

    expect(result).toEqual({
      user: mockUser,
      session: mockSession,
    })
  })
})

describe('requireParticipant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(requireParticipant(MOCK_SESSION_ID)).rejects.toThrow('Not authenticated')
  })

  it('throws "Not a participant" when no participation record', async () => {
    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.findUnique as MockInstance).mockResolvedValue({
      banned_at: null,
      suspended_until: null,
      deleted_at: null,
    })
    ;(prisma.participatesIn.findUnique as MockInstance).mockResolvedValue(null)
    await expect(requireParticipant(MOCK_SESSION_ID)).rejects.toThrow('Not a participant in this session')
  })

  it('throws "Not a participant" when participation has left_at set', async () => {
    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.findUnique as MockInstance).mockResolvedValue({
      banned_at: null,
      suspended_until: null,
      deleted_at: null,
    })
    ;(prisma.participatesIn.findUnique as MockInstance).mockResolvedValue({
      user_id: MOCK_USER_ID,
      session_id: MOCK_SESSION_ID,
      left_at: new Date(),
    })
    await expect(requireParticipant(MOCK_SESSION_ID)).rejects.toThrow('Not a participant in this session')
  })

  it('returns user when active participant', async () => {
    const mockUser = { id: MOCK_USER_ID }
    mockAuth(mockUser)
    ;(prisma.user.findUnique as MockInstance).mockResolvedValue({
      banned_at: null,
      suspended_until: null,
      deleted_at: null,
    })
    ;(prisma.participatesIn.findUnique as MockInstance).mockResolvedValue({
      user_id: MOCK_USER_ID,
      session_id: MOCK_SESSION_ID,
      left_at: null,
    })

    const result = await requireParticipant(MOCK_SESSION_ID)

    expect(result).toEqual(mockUser)
  })
})
