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
    participatesIn: {
      findMany: vi.fn(),
    },
  },
}))

import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import {
  getDebateState,
  startDebate,
  advanceTurn,
  pauseDebate,
  resumeDebate,
  endDebate,
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
    type: 'ONE_ON_ONE',
    ...overrides,
  })
}

const debaters = [
  { userId: 'u1', displayName: 'Alice' },
  { userId: 'u2', displayName: 'Bob' },
]

// ── getDebateState ──
describe('getDebateState', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when no state exists', async () => {
    mockAuth(MOCK_HOST_ID)
    ;(prisma.debateState.findUnique as any).mockResolvedValue(null)
    const result = await getDebateState(MOCK_SESSION_ID)
    expect(result).toBeNull()
  })

  it('returns shaped state when row exists', async () => {
    mockAuth(MOCK_HOST_ID)
    ;(prisma.debateState.findUnique as any).mockResolvedValue({
      session_id: MOCK_SESSION_ID,
      debater_order: debaters,
      current_index: 1,
      turn_length: 120,
      turn_ends_at: 9999999,
      is_paused: false,
      paused_time_remaining: 0,
      format: 'ONE_ON_ONE',
      phase: 'ACTIVE',
      version: 0,
    })
    const result = await getDebateState(MOCK_SESSION_ID)
    expect(result?.current_index).toBe(1)
    expect(result?.debater_order).toEqual(debaters)
    expect(result?.is_paused).toBe(false)
  })

  it('throws if not authenticated', async () => {
    mockAuth(null)
    await expect(getDebateState(MOCK_SESSION_ID)).rejects.toThrow('Not authenticated')
  })
})

// ── startDebate ──
describe('startDebate', () => {
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

  it('throws if fewer than 2 debaters', async () => {
    await expect(startDebate(MOCK_SESSION_ID, [debaters[0]], 120)).rejects.toThrow('At least 2 debaters')
  })

  it('throws if turnLength out of range', async () => {
    await expect(startDebate(MOCK_SESSION_ID, debaters, 0)).rejects.toThrow('Turn length must be between 1 and 1800')
    await expect(startDebate(MOCK_SESSION_ID, debaters, 2000)).rejects.toThrow('Turn length must be between 1 and 1800')
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
    expect(call.create.format).toBe('ONE_ON_ONE')
    expect(call.create.phase).toBe('ACTIVE')
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

  it('advances current_index using debater_order length', async () => {
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
    expect(update.data.phase).toBe('PAUSED')
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
    expect(update.data.phase).toBe('ACTIVE')
  })
})

// ── endDebate ──
describe('endDebate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_HOST_ID)
    mockSession()
    ;(prisma.debateState.update as any).mockResolvedValue({})
  })

  it('throws if not authorized', async () => {
    mockSession({ host_id: 'other', moderator_id: null })
    await expect(endDebate(MOCK_SESSION_ID)).rejects.toThrow('Not authorized')
  })

  it('updates debate state to ENDED phase', async () => {
    await endDebate(MOCK_SESSION_ID)
    expect(prisma.debateState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { session_id: MOCK_SESSION_ID },
        data: expect.objectContaining({ phase: 'ENDED' }),
      })
    )
  })

  it('does not throw if debate state already gone', async () => {
    ;(prisma.debateState.update as any).mockRejectedValue(new Error('not found'))
    await expect(endDebate(MOCK_SESSION_ID)).resolves.not.toThrow()
  })
})
