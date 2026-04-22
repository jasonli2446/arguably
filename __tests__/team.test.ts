import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionType } from '@/lib/generated/prisma'

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
    teamAssignment: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import {
  assignTeam,
  getTeamAssignments,
  removeFromTeam,
} from '@/lib/actions/team'

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

// ── assignTeam ──
describe('assignTeam', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    ;(prisma.session.findUnique as any).mockResolvedValue({
      id: MOCK_SESSION_ID,
      host_id: MOCK_USER_ID,
      moderator_id: null,
      type: SessionType.TEAM,
    })
    ;(prisma.teamAssignment.upsert as any).mockResolvedValue({})
  })

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(
      assignTeam(MOCK_SESSION_ID, MOCK_TARGET_USER_ID, 'proponent')
    ).rejects.toThrow('Not authenticated')
  })

  it('throws "Session not found"', async () => {
    ;(prisma.session.findUnique as any).mockResolvedValue(null)
    await expect(
      assignTeam(MOCK_SESSION_ID, MOCK_TARGET_USER_ID, 'proponent')
    ).rejects.toThrow('Session not found')
  })

  it('throws "Not authorized"', async () => {
    ;(prisma.session.findUnique as any).mockResolvedValue({
      id: MOCK_SESSION_ID,
      host_id: 'other-user',
      moderator_id: null,
      type: SessionType.TEAM,
    })
    await expect(
      assignTeam(MOCK_SESSION_ID, MOCK_TARGET_USER_ID, 'proponent')
    ).rejects.toThrow('Not authorized')
  })

  it('throws "Team assignments are only for TEAM format sessions" (mock session.type as ONE_ON_ONE)', async () => {
    ;(prisma.session.findUnique as any).mockResolvedValue({
      id: MOCK_SESSION_ID,
      host_id: MOCK_USER_ID,
      moderator_id: null,
      type: SessionType.ONE_ON_ONE,
    })
    await expect(
      assignTeam(MOCK_SESSION_ID, MOCK_TARGET_USER_ID, 'proponent')
    ).rejects.toThrow('Team assignments are only for TEAM format sessions')
  })

  it('throws "Team must be \'proponent\' or \'opponent\'" with invalid team name', async () => {
    await expect(
      assignTeam(MOCK_SESSION_ID, MOCK_TARGET_USER_ID, 'invalid-team')
    ).rejects.toThrow("Team must be 'proponent' or 'opponent'")
  })

  it('calls prisma.teamAssignment.upsert on success', async () => {
    await assignTeam(MOCK_SESSION_ID, MOCK_TARGET_USER_ID, 'proponent')
    expect(prisma.teamAssignment.upsert).toHaveBeenCalledWith({
      where: {
        session_id_user_id: {
          session_id: MOCK_SESSION_ID,
          user_id: MOCK_TARGET_USER_ID,
        },
      },
      create: {
        session_id: MOCK_SESSION_ID,
        user_id: MOCK_TARGET_USER_ID,
        team: 'proponent',
      },
      update: { team: 'proponent' },
    })
  })

  it('allows moderator to assign team', async () => {
    ;(prisma.session.findUnique as any).mockResolvedValue({
      id: MOCK_SESSION_ID,
      host_id: 'other-user',
      moderator_id: MOCK_USER_ID,
      type: SessionType.TEAM,
    })
    await assignTeam(MOCK_SESSION_ID, MOCK_TARGET_USER_ID, 'opponent')
    expect(prisma.teamAssignment.upsert).toHaveBeenCalled()
  })
})

// ── getTeamAssignments ──
describe('getTeamAssignments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prisma.teamAssignment.findMany as any).mockResolvedValue([])
  })

  it('calls prisma.teamAssignment.findMany with user include', async () => {
    await getTeamAssignments(MOCK_SESSION_ID)
    expect(prisma.teamAssignment.findMany).toHaveBeenCalledWith({
      where: { session_id: MOCK_SESSION_ID },
      include: {
        user: { select: { id: true, username: true, realname: true } },
      },
      orderBy: { assigned_at: 'asc' },
    })
  })
})

// ── removeFromTeam ──
describe('removeFromTeam', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    ;(prisma.session.findUnique as any).mockResolvedValue({
      id: MOCK_SESSION_ID,
      host_id: MOCK_USER_ID,
      moderator_id: null,
    })
    ;(prisma.teamAssignment.delete as any).mockResolvedValue({})
  })

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(
      removeFromTeam(MOCK_SESSION_ID, MOCK_TARGET_USER_ID)
    ).rejects.toThrow('Not authenticated')
  })

  it('calls prisma.teamAssignment.delete with correct key', async () => {
    await removeFromTeam(MOCK_SESSION_ID, MOCK_TARGET_USER_ID)
    expect(prisma.teamAssignment.delete).toHaveBeenCalledWith({
      where: {
        session_id_user_id: {
          session_id: MOCK_SESSION_ID,
          user_id: MOCK_TARGET_USER_ID,
        },
      },
    })
  })
})
