import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    session: { findUnique: vi.fn() },
    debateState: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    // Needed for doPromoteFromQueue called inside debate actions
    audienceQueue: { findFirst: vi.fn(), delete: vi.fn() },
    participatesIn: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/actions/queue', () => ({
  doPromoteFromQueue: vi.fn().mockResolvedValue(null),
  cleanupUserVotes: vi.fn().mockResolvedValue(undefined),
}))

import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import {
  getDebateState,
  startDebate,
  advanceTurn,
  advanceTurnIfExpired,
  pauseDebate,
  resumeDebate,
  endDebate,
  extendTurn,
} from '@/lib/actions/debate'

const MOCK_HOST_ID = 'host-uuid'
const MOCK_SESSION_ID = 'session-cuid'

function mockAuth(userId: string | null) {
  ;(createClient as any).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  })
}

function mockSession(overrides: Record<string, any> = {}) {
  ;(prisma.session.findUnique as any).mockResolvedValue({
    id: MOCK_SESSION_ID,
    host_id: MOCK_HOST_ID,
    moderator_id: null,
    ...overrides,
  })
}

const debaters = [
  { userId: 'u1', displayName: 'Alice' },
  { userId: 'u2', displayName: 'Bob' },
]

// ── getDebateState ──
describe('getDebateState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth('any-user')
  })

  it('returns null when no state exists', async () => {
    ;(prisma.debateState.findUnique as any).mockResolvedValue(null)
    const result = await getDebateState(MOCK_SESSION_ID)
    expect(result).toBeNull()
  })

  it('returns shaped state when row exists', async () => {
    ;(prisma.debateState.findUnique as any).mockResolvedValue({
      session_id: MOCK_SESSION_ID,
      debater_order: debaters,
      current_index: 1,
      turn_length: 120,
      turn_ends_at: 9999999,
      is_paused: false,
      paused_time_remaining: 0,
    })
    const result = await getDebateState(MOCK_SESSION_ID)
    expect(result?.current_index).toBe(1)
    expect(result?.debater_order).toEqual(debaters)
    expect(result?.is_paused).toBe(false)
  })
})

// ── startDebate ──
describe('startDebate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_HOST_ID)
    mockSession()
    ;(prisma.debateState.upsert as any).mockResolvedValue({})
    // Mock: both debaters are active participants
    ;(prisma.participatesIn.findMany as any).mockResolvedValue([
      { user_id: 'u1' },
      { user_id: 'u2' },
    ])
  })

  it('throws if not authenticated', async () => {
    mockAuth(null)
    await expect(startDebate(MOCK_SESSION_ID, debaters, 120)).rejects.toThrow('Not authenticated')
  })

  it('throws if session not found', async () => {
    ;(prisma.session.findUnique as any).mockResolvedValue(null)
    await expect(startDebate(MOCK_SESSION_ID, debaters, 120)).rejects.toThrow('Session not found')
  })

  it('throws if caller is not host or moderator', async () => {
    mockSession({ host_id: 'other-user', moderator_id: null })
    await expect(startDebate(MOCK_SESSION_ID, debaters, 120)).rejects.toThrow('Not authorized')
  })

  it('throws if fewer than 2 debaters for non-Expert format', async () => {
    await expect(startDebate(MOCK_SESSION_ID, [debaters[0]], 120)).rejects.toThrow('At least 2 debaters')
  })

  it('accepts >= 2 debaters for non-Expert formats', async () => {
    const threeDebaters = [
      { userId: 'u1', displayName: 'Alice' },
      { userId: 'u2', displayName: 'Bob' },
      { userId: 'u3', displayName: 'Charlie' },
    ]
    ;(prisma.participatesIn.findMany as any).mockResolvedValue([
      { user_id: 'u1' },
      { user_id: 'u2' },
      { user_id: 'u3' },
    ])
    await startDebate(MOCK_SESSION_ID, threeDebaters, 120)
    expect(prisma.debateState.upsert).toHaveBeenCalled()
  })

  it('upserts debate state with correct initial values', async () => {
    const before = Date.now()
    await startDebate(MOCK_SESSION_ID, debaters, 60)
    const call = (prisma.debateState.upsert as any).mock.calls[0][0]
    expect(call.create.current_index).toBe(0)
    expect(call.create.is_paused).toBe(false)
    expect(call.create.turn_length).toBe(60)
    expect(call.create.turn_ends_at).toBeGreaterThanOrEqual(before + 60_000)
    expect(call.create.debater_order).toEqual(debaters)
  })

  it('allows moderator to start debate', async () => {
    mockSession({ host_id: 'other', moderator_id: MOCK_HOST_ID })
    await startDebate(MOCK_SESSION_ID, debaters, 120)
    expect(prisma.debateState.upsert).toHaveBeenCalled()
  })
})

// ── advanceTurn ──
describe('advanceTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_HOST_ID)
    mockSession()
    ;(prisma.debateState.update as any).mockResolvedValue({})
  })

  it('throws if no active debate', async () => {
    ;(prisma.debateState.findUnique as any).mockResolvedValue(null)
    await expect(advanceTurn(MOCK_SESSION_ID)).rejects.toThrow('No active debate')
  })

  it('advances current_index from 0 to 1', async () => {
    ;(prisma.debateState.findUnique as any).mockResolvedValue({
      current_index: 0, turn_length: 60, is_paused: false,
      debater_order: debaters,
    })
    await advanceTurn(MOCK_SESSION_ID)
    const update = (prisma.debateState.update as any).mock.calls[0][0]
    expect(update.data.current_index).toBe(1)
    expect(update.data.is_paused).toBe(false)
  })

  it('wraps current_index from 1 back to 0', async () => {
    ;(prisma.debateState.findUnique as any).mockResolvedValue({
      current_index: 1, turn_length: 60, is_paused: false,
      debater_order: debaters,
    })
    await advanceTurn(MOCK_SESSION_ID)
    const update = (prisma.debateState.update as any).mock.calls[0][0]
    expect(update.data.current_index).toBe(0)
  })

  it('sets new turn_ends_at from now + turn_length', async () => {
    ;(prisma.debateState.findUnique as any).mockResolvedValue({
      current_index: 0, turn_length: 90, is_paused: false,
      debater_order: debaters,
    })
    const before = Date.now()
    await advanceTurn(MOCK_SESSION_ID)
    const update = (prisma.debateState.update as any).mock.calls[0][0]
    expect(update.data.turn_ends_at).toBeGreaterThanOrEqual(before + 90_000)
  })

  it('wraps correctly with 3 debaters', async () => {
    const threeDebaters = [
      { userId: 'u1', displayName: 'Alice' },
      { userId: 'u2', displayName: 'Bob' },
      { userId: 'u3', displayName: 'Charlie' },
    ]
    ;(prisma.debateState.findUnique as any).mockResolvedValue({
      current_index: 2, turn_length: 60, is_paused: false,
      debater_order: threeDebaters,
    })
    await advanceTurn(MOCK_SESSION_ID)
    const update = (prisma.debateState.update as any).mock.calls[0][0]
    expect(update.data.current_index).toBe(0)
  })
})

// ── advanceTurnIfExpired ──
describe('advanceTurnIfExpired', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth('any-user')
    mockSession({ type: 'ONE_ON_ONE' })
    ;(prisma.debateState.updateMany as any).mockResolvedValue({ count: 1 })
    // Mock: user is an active participant
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: 'any-user',
      session_id: MOCK_SESSION_ID,
      left_at: null,
    })
  })

  it('does nothing if unauthenticated', async () => {
    mockAuth(null)
    await advanceTurnIfExpired(MOCK_SESSION_ID)
    expect(prisma.debateState.updateMany).not.toHaveBeenCalled()
  })

  it('does nothing if no state', async () => {
    ;(prisma.debateState.findUnique as any).mockResolvedValue(null)
    await advanceTurnIfExpired(MOCK_SESSION_ID)
    expect(prisma.debateState.updateMany).not.toHaveBeenCalled()
  })

  it('does nothing if paused', async () => {
    ;(prisma.debateState.findUnique as any).mockResolvedValue({
      is_paused: true, turn_ends_at: Date.now() - 5000, current_index: 0, turn_length: 60,
      debater_order: debaters,
    })
    await advanceTurnIfExpired(MOCK_SESSION_ID)
    expect(prisma.debateState.updateMany).not.toHaveBeenCalled()
  })

  it('does nothing if turn has not expired yet', async () => {
    ;(prisma.debateState.findUnique as any).mockResolvedValue({
      is_paused: false, turn_ends_at: Date.now() + 30_000, current_index: 0, turn_length: 60,
      debater_order: debaters,
    })
    await advanceTurnIfExpired(MOCK_SESSION_ID)
    expect(prisma.debateState.updateMany).not.toHaveBeenCalled()
  })

  it('calls updateMany with atomic guard when turn expired', async () => {
    ;(prisma.debateState.findUnique as any).mockResolvedValue({
      is_paused: false, turn_ends_at: Date.now() - 2000, current_index: 0, turn_length: 60,
      debater_order: debaters,
    })
    await advanceTurnIfExpired(MOCK_SESSION_ID)
    expect(prisma.debateState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ current_index: 0, is_paused: false }),
        data: expect.objectContaining({ current_index: 1 }),
      })
    )
  })
})

// ── pauseDebate ──
describe('pauseDebate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_HOST_ID)
    mockSession()
    ;(prisma.debateState.update as any).mockResolvedValue({})
  })

  it('throws if no active debate', async () => {
    ;(prisma.debateState.findUnique as any).mockResolvedValue(null)
    await expect(pauseDebate(MOCK_SESSION_ID)).rejects.toThrow('No active debate')
  })

  it('throws if already paused', async () => {
    ;(prisma.debateState.findUnique as any).mockResolvedValue({ is_paused: true, turn_ends_at: null })
    await expect(pauseDebate(MOCK_SESSION_ID)).rejects.toThrow('Already paused')
  })

  it('sets is_paused to true and clears turn_ends_at', async () => {
    ;(prisma.debateState.findUnique as any).mockResolvedValue({
      is_paused: false, turn_ends_at: Date.now() + 30_000,
    })
    await pauseDebate(MOCK_SESSION_ID)
    const update = (prisma.debateState.update as any).mock.calls[0][0]
    expect(update.data.is_paused).toBe(true)
    expect(update.data.turn_ends_at).toBeNull()
  })

  it('saves correct paused_time_remaining', async () => {
    const turnEndsAt = Date.now() + 45_000
    ;(prisma.debateState.findUnique as any).mockResolvedValue({
      is_paused: false, turn_ends_at: turnEndsAt,
    })
    await pauseDebate(MOCK_SESSION_ID)
    const update = (prisma.debateState.update as any).mock.calls[0][0]
    expect(update.data.paused_time_remaining).toBeGreaterThan(40)
    expect(update.data.paused_time_remaining).toBeLessThanOrEqual(45)
  })
})

// ── resumeDebate ──
describe('resumeDebate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_HOST_ID)
    mockSession()
    ;(prisma.debateState.update as any).mockResolvedValue({})
  })

  it('throws if not paused', async () => {
    ;(prisma.debateState.findUnique as any).mockResolvedValue({ is_paused: false })
    await expect(resumeDebate(MOCK_SESSION_ID)).rejects.toThrow('Not paused')
  })

  it('sets is_paused to false and restores turn_ends_at', async () => {
    ;(prisma.debateState.findUnique as any).mockResolvedValue({
      is_paused: true, paused_time_remaining: 45,
    })
    const before = Date.now()
    await resumeDebate(MOCK_SESSION_ID)
    const update = (prisma.debateState.update as any).mock.calls[0][0]
    expect(update.data.is_paused).toBe(false)
    expect(update.data.turn_ends_at).toBeGreaterThanOrEqual(before + 45_000)
  })
})

// ── endDebate ──
describe('endDebate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_HOST_ID)
    mockSession()
    ;(prisma.debateState.delete as any).mockResolvedValue({})
  })

  it('throws if not authorized', async () => {
    mockSession({ host_id: 'other', moderator_id: null })
    await expect(endDebate(MOCK_SESSION_ID)).rejects.toThrow('Not authorized')
  })

  it('deletes the debate state', async () => {
    await endDebate(MOCK_SESSION_ID)
    expect(prisma.debateState.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { session_id: MOCK_SESSION_ID } })
    )
  })

  it('does not throw if debate state already gone', async () => {
    ;(prisma.debateState.delete as any).mockRejectedValue(new Error('not found'))
    await expect(endDebate(MOCK_SESSION_ID)).resolves.not.toThrow()
  })
})

// ── Security: getDebateState auth check ──
describe('getDebateState — security', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws if not authenticated', async () => {
    mockAuth(null)
    await expect(getDebateState(MOCK_SESSION_ID)).rejects.toThrow('Not authenticated')
  })

  it('returns state when authenticated', async () => {
    mockAuth('any-user')
    ;(prisma.debateState.findUnique as any).mockResolvedValue({
      session_id: MOCK_SESSION_ID,
      debater_order: debaters,
      current_index: 0,
      turn_length: 120,
      turn_ends_at: 9999999,
      is_paused: false,
      paused_time_remaining: 0,
    })
    const result = await getDebateState(MOCK_SESSION_ID)
    expect(result).not.toBeNull()
    expect(result?.session_id).toBe(MOCK_SESSION_ID)
  })
})

// ── Security: startDebate input validation ──
describe('startDebate — security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_HOST_ID)
    mockSession()
    ;(prisma.debateState.upsert as any).mockResolvedValue({})
    ;(prisma.participatesIn.findMany as any).mockResolvedValue([
      { user_id: 'u1' },
      { user_id: 'u2' },
    ])
  })

  it('throws if turnLength is less than 1', async () => {
    await expect(startDebate(MOCK_SESSION_ID, debaters, 0)).rejects.toThrow(
      'Turn length must be at least 1 second'
    )
  })

  it('throws if turnLength exceeds 1800', async () => {
    await expect(startDebate(MOCK_SESSION_ID, debaters, 1801)).rejects.toThrow(
      'Turn length cannot exceed 30 minutes'
    )
  })

  it('allows turnLength of exactly 1', async () => {
    await expect(startDebate(MOCK_SESSION_ID, debaters, 1)).resolves.not.toThrow()
  })

  it('allows turnLength of exactly 1800', async () => {
    await expect(startDebate(MOCK_SESSION_ID, debaters, 1800)).resolves.not.toThrow()
  })

  it('throws if debater IDs are not active participants', async () => {
    ;(prisma.participatesIn.findMany as any).mockResolvedValue([
      { user_id: 'u1' },
    ])
    await expect(startDebate(MOCK_SESSION_ID, debaters, 120)).rejects.toThrow(
      'is not an active participant'
    )
  })

  it('succeeds when both debaters are active participants', async () => {
    await expect(startDebate(MOCK_SESSION_ID, debaters, 120)).resolves.not.toThrow()
    expect(prisma.debateState.upsert).toHaveBeenCalled()
  })
})

// ── Security: advanceTurnIfExpired participant check ──
describe('advanceTurnIfExpired — security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth('any-user')
    ;(prisma.debateState.updateMany as any).mockResolvedValue({ count: 1 })
  })

  it('does nothing if user is not a participant', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue(null)
    await advanceTurnIfExpired(MOCK_SESSION_ID)
    expect(prisma.debateState.updateMany).not.toHaveBeenCalled()
  })

  it('does nothing if user has left the session', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: 'any-user',
      session_id: MOCK_SESSION_ID,
      left_at: new Date(),
    })
    await advanceTurnIfExpired(MOCK_SESSION_ID)
    expect(prisma.debateState.updateMany).not.toHaveBeenCalled()
  })

  it('advances turn when user is active participant and turn expired', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: 'any-user',
      session_id: MOCK_SESSION_ID,
      left_at: null,
    })
    ;(prisma.debateState.findUnique as any).mockResolvedValue({
      is_paused: false, turn_ends_at: Date.now() - 2000, current_index: 0, turn_length: 60,
      debater_order: debaters,
    })
    // advanceTurnIfExpired fetches session.type to check Expert vs Crowd
    ;(prisma.session.findUnique as any).mockResolvedValue({ type: 'ONE_ON_ONE' })
    await advanceTurnIfExpired(MOCK_SESSION_ID)
    expect(prisma.debateState.updateMany).toHaveBeenCalled()
  })
})

// ── extendTurn ──
describe('extendTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_HOST_ID)
    mockSession()
    ;(prisma.debateState.update as any).mockResolvedValue({})
  })

  it('throws if not authorized', async () => {
    mockSession({ host_id: 'other', moderator_id: null })
    await expect(extendTurn(MOCK_SESSION_ID, 30)).rejects.toThrow('Not authorized')
  })

  it('throws if no active debate', async () => {
    ;(prisma.debateState.findUnique as any).mockResolvedValue(null)
    await expect(extendTurn(MOCK_SESSION_ID, 30)).rejects.toThrow('No active debate')
  })

  it('adds extra seconds to turn_ends_at when debate is live', async () => {
    const currentTurnEndsAt = Date.now() + 30_000
    ;(prisma.debateState.findUnique as any).mockResolvedValue({
      is_paused: false,
      turn_ends_at: currentTurnEndsAt,
      paused_time_remaining: 0,
    })
    await extendTurn(MOCK_SESSION_ID, 30)
    const update = (prisma.debateState.update as any).mock.calls[0][0]
    expect(update.data.turn_ends_at).toBe(currentTurnEndsAt + 30_000)
  })

  it('adds extra seconds to paused_time_remaining when debate is paused', async () => {
    ;(prisma.debateState.findUnique as any).mockResolvedValue({
      is_paused: true,
      turn_ends_at: null,
      paused_time_remaining: 45,
    })
    await extendTurn(MOCK_SESSION_ID, 30)
    const update = (prisma.debateState.update as any).mock.calls[0][0]
    expect(update.data.paused_time_remaining).toBe(75)
  })

  it('throws if live but turn_ends_at is null', async () => {
    ;(prisma.debateState.findUnique as any).mockResolvedValue({
      is_paused: false,
      turn_ends_at: null,
      paused_time_remaining: 0,
    })
    await expect(extendTurn(MOCK_SESSION_ID, 30)).rejects.toThrow('No active turn')
  })

  it('allows moderator to extend turn', async () => {
    mockSession({ host_id: 'other', moderator_id: MOCK_HOST_ID })
    ;(prisma.debateState.findUnique as any).mockResolvedValue({
      is_paused: false,
      turn_ends_at: Date.now() + 20_000,
      paused_time_remaining: 0,
    })
    await extendTurn(MOCK_SESSION_ID, 60)
    expect(prisma.debateState.update).toHaveBeenCalled()
  })

  it('handles extending by different amounts', async () => {
    ;(prisma.debateState.findUnique as any).mockResolvedValue({
      is_paused: true,
      turn_ends_at: null,
      paused_time_remaining: 10,
    })
    await extendTurn(MOCK_SESSION_ID, 120)
    const update = (prisma.debateState.update as any).mock.calls[0][0]
    expect(update.data.paused_time_remaining).toBe(130)
  })
})
