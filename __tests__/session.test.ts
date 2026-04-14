import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionRole, SessionStatus, SessionType } from '@/lib/generated/prisma'

// ── Mocks ──
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/actions/queue', () => ({
  doPromoteFromQueue: vi.fn().mockResolvedValue(null),
  cleanupUserVotes: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/prisma', () => {
  const prismaMock = {
    session: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    participatesIn: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    audienceQueue: {
      deleteMany: vi.fn(),
    },
    vote: {
      deleteMany: vi.fn(),
    },
    debateState: {
      findUnique: vi.fn(),
    },
    roleHistory: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(async (callback: any) => callback(prismaMock)),
  }

  return { prisma: prismaMock }
})

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import {
  createSession,
  joinSession,
  joinSessionAsDebater,
  leaveSession,
  updateSessionStatus,
  assignModerator,
  kickParticipant,
  promoteToDebater,
} from '@/lib/actions/session'

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

const MOCK_USER_ID = 'user-uuid-1234'
const MOCK_SESSION_ID = 'session-cuid-5678'

// Helper for a minimal session form
function sessionForm(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Test Debate',
    description: 'A test',
    type: SessionType.ONE_ON_ONE,
    debaterCapacityProponent: 1,
    debaterCapacityOpponent: 1,
    debaterCapacityPanel: null,
    audienceCapacity: 10,
    turnLength: 120,
    ...overrides,
  }
}

// ── createSession ──
describe('createSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    ;(prisma.session.findUnique as any).mockResolvedValue(null) // no code collision
    ;(prisma.session.create as any).mockResolvedValue({ id: MOCK_SESSION_ID, code: 'ARG-1234' })
  })

  it('throws if not authenticated', async () => {
    mockAuth(null)
    await expect(createSession(sessionForm() as any)).rejects.toThrow('Not authenticated')
  })

  it('throws if name is empty', async () => {
    await expect(createSession(sessionForm({ name: '  ' }) as any)).rejects.toThrow('Room name is required')
  })

  it('throws if turnLength < 1', async () => {
    await expect(createSession(sessionForm({ turnLength: 0 }) as any)).rejects.toThrow('Turn length must be at least 1 second')
  })

  it('throws for PANEL type with proponent/opponent capacities set', async () => {
    await expect(
      createSession(sessionForm({
        type: SessionType.PANEL,
        debaterCapacityPanel: 4,
        debaterCapacityProponent: 2, // should be null for PANEL
        debaterCapacityOpponent: 2,
      }) as any)
    ).rejects.toThrow('Proponent and opponent capacities must be null for PANEL format')
  })

  it('throws for PANEL type with debaterCapacityPanel < 2', async () => {
    await expect(
      createSession(sessionForm({
        type: SessionType.PANEL,
        debaterCapacityPanel: 1,
        debaterCapacityProponent: null,
        debaterCapacityOpponent: null,
      }) as any)
    ).rejects.toThrow('Panel must have at least 2 panelists')
  })

  it('creates session with HOST role for creator', async () => {
    await createSession(sessionForm() as any)
    expect(prisma.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          host_id: MOCK_USER_ID,
          participates_ins: expect.objectContaining({
            create: expect.objectContaining({
              user_id: MOCK_USER_ID,
              session_role: SessionRole.HOST,
            }),
          }),
        }),
      })
    )
  })

  it('calls redirect after creation', async () => {
    await createSession(sessionForm() as any)
    expect(redirect).toHaveBeenCalled()
  })

  it('creates PANEL session with debaterCapacityPanel', async () => {
    await createSession(sessionForm({
      type: SessionType.PANEL,
      debaterCapacityProponent: null,
      debaterCapacityOpponent: null,
      debaterCapacityPanel: 4,
    }) as any)
    expect(prisma.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: SessionType.PANEL,
          debater_capacity_panel: 4,
        }),
      })
    )
  })

  it('throws if audience capacity is negative', async () => {
    await expect(createSession(sessionForm({ audienceCapacity: -1 }) as any)).rejects.toThrow(
      'Audience capacity cannot be negative'
    )
  })

  it('stores kick_threshold when provided', async () => {
    await createSession(sessionForm({ kickThreshold: 75 }) as any)
    expect(prisma.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kick_threshold: 75,
        }),
      })
    )
  })
})

// ── joinSession ──
describe('joinSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue(null) // not already joined
    ;(prisma.participatesIn.create as any).mockResolvedValue({})
    ;(prisma.participatesIn.update as any).mockResolvedValue({})
  })

  // ONE_ON_ONE: totalCapacity = 1 + 1 + 10 + 1 = 13
  function mockSessionForJoin(overrides: Record<string, unknown> = {}) {
    ;(prisma.session.findUnique as any).mockResolvedValue({
      type: SessionType.ONE_ON_ONE,
      status: SessionStatus.WAITING,
      debater_capacity_proponent: 1,
      debater_capacity_opponent: 1,
      debater_capacity_panel: null,
      audience_capacity: 10,
      _count: { participates_ins: 0 },
      ...overrides,
    })
  }

  it('throws if not authenticated', async () => {
    mockAuth(null)
    await expect(joinSession(MOCK_SESSION_ID)).rejects.toThrow('Not authenticated')
  })

  it('throws if session not found', async () => {
    ;(prisma.session.findUnique as any).mockResolvedValue(null)
    await expect(joinSession(MOCK_SESSION_ID)).rejects.toThrow('Session not found')
  })

  it('throws if session has ended', async () => {
    mockSessionForJoin({ status: SessionStatus.ENDED })
    await expect(joinSession(MOCK_SESSION_ID)).rejects.toThrow('Session has ended')
  })

  it('throws if session is full', async () => {
    // totalCapacity = 1 + 1 + 10 + 1 = 13, so 13 participants means full
    mockSessionForJoin({ _count: { participates_ins: 13 } })
    await expect(joinSession(MOCK_SESSION_ID)).rejects.toThrow('Session is full')
  })

  it('creates ParticipatesIn with AUDIENCE role for new user', async () => {
    mockSessionForJoin()
    await joinSession(MOCK_SESSION_ID)
    expect(prisma.participatesIn.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: MOCK_USER_ID,
          session_id: MOCK_SESSION_ID,
          session_role: SessionRole.AUDIENCE,
        }),
      })
    )
  })

  it('clears left_at for returning user (re-join)', async () => {
    mockSessionForJoin()
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: MOCK_USER_ID,
      session_id: MOCK_SESSION_ID,
      left_at: new Date(),
    })
    await joinSession(MOCK_SESSION_ID)
    expect(prisma.participatesIn.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ left_at: null }),
      })
    )
  })
})

// ── joinSessionAsDebater ──
describe('joinSessionAsDebater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue(null)
    ;(prisma.participatesIn.create as any).mockResolvedValue({})
    ;(prisma.participatesIn.update as any).mockResolvedValue({})
  })

  // ONE_ON_ONE: totalCapacity = 1+1+10+1 = 13, totalDebaterCapacity = 2
  function mockSessionForDebater(overrides: Record<string, unknown> = {}) {
    ;(prisma.session.findUnique as any).mockResolvedValue({
      type: SessionType.ONE_ON_ONE,
      status: SessionStatus.WAITING,
      debater_capacity_proponent: 1,
      debater_capacity_opponent: 1,
      debater_capacity_panel: null,
      audience_capacity: 10,
      _count: { participates_ins: 0 },
      participates_ins: [],
      ...overrides,
    })
  }

  it('throws if not authenticated', async () => {
    mockAuth(null)
    await expect(joinSessionAsDebater(MOCK_SESSION_ID, false)).rejects.toThrow('Not authenticated')
  })

  it('throws if session not found', async () => {
    ;(prisma.session.findUnique as any).mockResolvedValue(null)
    await expect(joinSessionAsDebater(MOCK_SESSION_ID, false)).rejects.toThrow('Session not found')
  })

  it('throws if session has ended', async () => {
    mockSessionForDebater({ status: SessionStatus.ENDED })
    await expect(joinSessionAsDebater(MOCK_SESSION_ID, false)).rejects.toThrow('Session has ended')
  })

  it('throws if isProponent is true for ONE_ON_ONE', async () => {
    mockSessionForDebater()
    await expect(joinSessionAsDebater(MOCK_SESSION_ID, true)).rejects.toThrow(
      'Cannot join as proponent in this session type'
    )
  })

  it('throws if isProponent is true for EXPERT_VS_CROWD', async () => {
    mockSessionForDebater({ type: SessionType.EXPERT_VS_CROWD })
    await expect(joinSessionAsDebater(MOCK_SESSION_ID, true)).rejects.toThrow(
      'Cannot join as proponent in this session type'
    )
  })

  it('throws if debater slots are full', async () => {
    // totalDebaterCapacity = 1 + 1 = 2, so 2 existing debaters means full
    mockSessionForDebater({
      participates_ins: [{ user_id: 'a' }, { user_id: 'b' }],
    })
    await expect(joinSessionAsDebater(MOCK_SESSION_ID, false)).rejects.toThrow('Debate already has 2 debaters')
  })

  it('creates ParticipatesIn with DEBATER role for new user', async () => {
    mockSessionForDebater()
    await joinSessionAsDebater(MOCK_SESSION_ID, false)
    expect(prisma.participatesIn.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: MOCK_USER_ID,
          session_id: MOCK_SESSION_ID,
          session_role: SessionRole.DEBATER,
        }),
      })
    )
  })

  it('updates existing participant to DEBATER on re-join', async () => {
    mockSessionForDebater()
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: MOCK_USER_ID,
      session_id: MOCK_SESSION_ID,
      left_at: new Date(),
    })
    await joinSessionAsDebater(MOCK_SESSION_ID, false)
    expect(prisma.participatesIn.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ session_role: SessionRole.DEBATER }),
      })
    )
  })
})

// ── leaveSession ──
describe('leaveSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: MOCK_USER_ID,
      session_id: MOCK_SESSION_ID,
      session_role: SessionRole.AUDIENCE,
    })
    ;(prisma.participatesIn.update as any).mockResolvedValue({})
    ;(prisma.audienceQueue.deleteMany as any).mockResolvedValue({})
    ;(prisma.vote.deleteMany as any).mockResolvedValue({})
    ;(prisma.debateState.findUnique as any).mockResolvedValue(null)
  })

  it('throws if not authenticated', async () => {
    mockAuth(null)
    await expect(leaveSession(MOCK_SESSION_ID)).rejects.toThrow('Not authenticated')
  })

  it('sets left_at to current time', async () => {
    const before = Date.now()
    await leaveSession(MOCK_SESSION_ID)
    const call = (prisma.participatesIn.update as any).mock.calls[0][0]
    expect(call.data.left_at).toBeInstanceOf(Date)
    expect(call.data.left_at.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('updates the correct user/session record', async () => {
    await leaveSession(MOCK_SESSION_ID)
    expect(prisma.participatesIn.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id_session_id: expect.objectContaining({
            user_id: MOCK_USER_ID,
            session_id: MOCK_SESSION_ID,
          }),
        }),
      })
    )
  })

  it('cleans up queue entry and votes', async () => {
    await leaveSession(MOCK_SESSION_ID)
    expect(prisma.audienceQueue.deleteMany).toHaveBeenCalled()
  })
})

// ── updateSessionStatus ──
describe('updateSessionStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    ;(prisma.session.update as any).mockResolvedValue({})
  })

  function mockSessionForUpdate(hostId = MOCK_USER_ID, moderatorId: string | null = null) {
    ;(prisma.session.findUnique as any).mockResolvedValue({
      id: MOCK_SESSION_ID,
      host_id: hostId,
      moderator_id: moderatorId,
      host: { id: hostId },
      moderator: moderatorId ? { id: moderatorId } : null,
    })
  }

  it('throws if not authenticated', async () => {
    mockAuth(null)
    await expect(updateSessionStatus(MOCK_SESSION_ID, SessionStatus.LIVE)).rejects.toThrow('Not authenticated')
  })

  it('throws if session not found', async () => {
    ;(prisma.session.findUnique as any).mockResolvedValue(null)
    await expect(updateSessionStatus(MOCK_SESSION_ID, SessionStatus.LIVE)).rejects.toThrow('Session not found')
  })

  it('throws if caller is not host or moderator', async () => {
    mockSessionForUpdate('other-user-id', null)
    await expect(updateSessionStatus(MOCK_SESSION_ID, SessionStatus.LIVE)).rejects.toThrow('Only moderators or hosts')
  })

  it('allows host to update status', async () => {
    mockSessionForUpdate(MOCK_USER_ID)
    await updateSessionStatus(MOCK_SESSION_ID, SessionStatus.LIVE)
    expect(prisma.session.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: SessionStatus.LIVE }),
      })
    )
  })

  it('allows moderator to update status', async () => {
    mockSessionForUpdate('some-host-id', MOCK_USER_ID)
    await updateSessionStatus(MOCK_SESSION_ID, SessionStatus.PAUSED)
    expect(prisma.session.update).toHaveBeenCalled()
  })

  it('sets ended_at when status is ENDED', async () => {
    mockSessionForUpdate(MOCK_USER_ID)
    const before = Date.now()
    await updateSessionStatus(MOCK_SESSION_ID, SessionStatus.ENDED)
    const call = (prisma.session.update as any).mock.calls[0][0]
    expect(call.data.ended_at).toBeInstanceOf(Date)
    expect(call.data.ended_at.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('does NOT set ended_at when status is LIVE', async () => {
    mockSessionForUpdate(MOCK_USER_ID)
    await updateSessionStatus(MOCK_SESSION_ID, SessionStatus.LIVE)
    const call = (prisma.session.update as any).mock.calls[0][0]
    expect(call.data.ended_at).toBeUndefined()
  })

  it('allows moderator to end session', async () => {
    mockSessionForUpdate('some-host-id', MOCK_USER_ID)
    const before = Date.now()
    await updateSessionStatus(MOCK_SESSION_ID, SessionStatus.ENDED)
    const call = (prisma.session.update as any).mock.calls[0][0]
    expect(call.data.status).toBe(SessionStatus.ENDED)
    expect(call.data.ended_at).toBeInstanceOf(Date)
    expect(call.data.ended_at.getTime()).toBeGreaterThanOrEqual(before)
  })
})

// ── Security: Input bounds validation ──
describe('createSession — security bounds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    ;(prisma.session.findUnique as any).mockResolvedValue(null)
    ;(prisma.session.create as any).mockResolvedValue({ id: MOCK_SESSION_ID, code: 'ARG-1234' })
  })

  it('throws if audienceCapacity exceeds 1000', async () => {
    await expect(createSession(sessionForm({ audienceCapacity: 1001 }) as any)).rejects.toThrow(
      'Audience capacity cannot exceed 1000'
    )
  })

  it('allows audienceCapacity of exactly 1000', async () => {
    await expect(createSession(sessionForm({ audienceCapacity: 1000 }) as any)).resolves.not.toThrow()
  })

  it('throws if turnLength exceeds 1800', async () => {
    await expect(createSession(sessionForm({ turnLength: 1801 }) as any)).rejects.toThrow(
      'Turn length cannot exceed 30 minutes'
    )
  })

  it('allows turnLength of exactly 1800', async () => {
    await expect(createSession(sessionForm({ turnLength: 1800 }) as any)).resolves.not.toThrow()
  })
})

// ── Security: assignModerator participant check ──
describe('assignModerator — participant check', () => {
  const TARGET_USER_ID = 'target-user-id'

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    ;(prisma.session.findUnique as any).mockResolvedValue({
      id: MOCK_SESSION_ID,
      host_id: MOCK_USER_ID,
      moderator_id: null,
    })
    ;(prisma.$transaction as any).mockResolvedValue([])
  })

  it('throws if target user is not an active participant', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue(null)
    await expect(assignModerator(MOCK_SESSION_ID, TARGET_USER_ID)).rejects.toThrow(
      'Target user is not an active participant'
    )
  })

  it('throws if target user has left the session', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: TARGET_USER_ID,
      session_id: MOCK_SESSION_ID,
      left_at: new Date(),
    })
    await expect(assignModerator(MOCK_SESSION_ID, TARGET_USER_ID)).rejects.toThrow(
      'Target user is not an active participant'
    )
  })

  it('succeeds when target user is an active participant', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: TARGET_USER_ID,
      session_id: MOCK_SESSION_ID,
      left_at: null,
    })
    await expect(assignModerator(MOCK_SESSION_ID, TARGET_USER_ID)).resolves.not.toThrow()
  })
})

// ── Security: kickParticipant participant check ──
describe('kickParticipant — participant check', () => {
  const TARGET_USER_ID = 'target-user-id'

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    ;(prisma.session.findUnique as any).mockResolvedValue({
      id: MOCK_SESSION_ID,
      host_id: MOCK_USER_ID,
      moderator_id: null,
    })
    ;(prisma.participatesIn.update as any).mockResolvedValue({})
    ;(prisma.audienceQueue.deleteMany as any).mockResolvedValue({})
    ;(prisma.vote.deleteMany as any).mockResolvedValue({})
    ;(prisma.debateState.findUnique as any).mockResolvedValue(null)
    // kickParticipant uses $transaction — restore the implementation after clearAllMocks
    ;(prisma.$transaction as any).mockImplementation(async (callback: any) => callback(prisma))
  })

  it('throws if target user is not an active participant', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue(null)
    await expect(kickParticipant(MOCK_SESSION_ID, TARGET_USER_ID)).rejects.toThrow(
      'Target user is not an active participant'
    )
  })

  it('throws if target user has already left', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: TARGET_USER_ID,
      session_id: MOCK_SESSION_ID,
      left_at: new Date(),
    })
    await expect(kickParticipant(MOCK_SESSION_ID, TARGET_USER_ID)).rejects.toThrow(
      'Target user is not an active participant'
    )
  })

  it('kicks active participant successfully', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: TARGET_USER_ID,
      session_id: MOCK_SESSION_ID,
      left_at: null,
      session_role: SessionRole.AUDIENCE,
    })
    await kickParticipant(MOCK_SESSION_ID, TARGET_USER_ID)
    expect(prisma.participatesIn.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ left_at: expect.any(Date) }),
      })
    )
  })
})

// ── promoteToDebater ──
describe('promoteToDebater', () => {
  const TARGET_USER_ID = 'target-user-uuid'

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    ;(prisma.participatesIn.update as any).mockResolvedValue({})
  })

  function mockSessionForPromote(overrides: Record<string, unknown> = {}) {
    ;(prisma.session.findUnique as any).mockResolvedValue({
      id: MOCK_SESSION_ID,
      host_id: MOCK_USER_ID,
      moderator_id: null,
      status: SessionStatus.WAITING,
      ...overrides,
    })
  }

  it('throws if not authenticated', async () => {
    mockAuth(null)
    await expect(promoteToDebater(MOCK_SESSION_ID, TARGET_USER_ID)).rejects.toThrow('Not authenticated')
  })

  it('throws if session not found', async () => {
    ;(prisma.session.findUnique as any).mockResolvedValue(null)
    await expect(promoteToDebater(MOCK_SESSION_ID, TARGET_USER_ID)).rejects.toThrow('Session not found')
  })

  it('throws if caller is not host or moderator', async () => {
    mockSessionForPromote({ host_id: 'other-user', moderator_id: null })
    await expect(promoteToDebater(MOCK_SESSION_ID, TARGET_USER_ID)).rejects.toThrow('Only moderators or hosts')
  })

  it('throws if session is not in WAITING status', async () => {
    mockSessionForPromote({ status: SessionStatus.LIVE })
    await expect(promoteToDebater(MOCK_SESSION_ID, TARGET_USER_ID)).rejects.toThrow('Can only promote participants before the debate starts')
  })

  it('throws if trying to promote yourself', async () => {
    mockSessionForPromote()
    await expect(promoteToDebater(MOCK_SESSION_ID, MOCK_USER_ID)).rejects.toThrow('Cannot promote yourself')
  })

  it('updates participant role to DEBATER', async () => {
    mockSessionForPromote()
    await promoteToDebater(MOCK_SESSION_ID, TARGET_USER_ID)
    expect(prisma.participatesIn.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id_session_id: { user_id: TARGET_USER_ID, session_id: MOCK_SESSION_ID },
        }),
        data: expect.objectContaining({ session_role: SessionRole.DEBATER }),
      })
    )
  })

  it('allows moderator to promote', async () => {
    mockSessionForPromote({ host_id: 'some-host', moderator_id: MOCK_USER_ID })
    await promoteToDebater(MOCK_SESSION_ID, TARGET_USER_ID)
    expect(prisma.participatesIn.update).toHaveBeenCalled()
  })

  it('throws when session is PAUSED', async () => {
    mockSessionForPromote({ status: SessionStatus.PAUSED })
    await expect(promoteToDebater(MOCK_SESSION_ID, TARGET_USER_ID)).rejects.toThrow('Can only promote participants before the debate starts')
  })

  it('throws when session is ENDED', async () => {
    mockSessionForPromote({ status: SessionStatus.ENDED })
    await expect(promoteToDebater(MOCK_SESSION_ID, TARGET_USER_ID)).rejects.toThrow('Can only promote participants before the debate starts')
  })
})
