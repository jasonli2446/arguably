import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest'

// ── Mocks ──
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    session: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    debateState: {
      updateMany: vi.fn(),
    },
    platformConfig: {
      upsert: vi.fn(),
    },
    adminAuditLog: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/actions/utils', () => ({
  requireAdmin: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/actions/utils'
import {
  getAdminDashboardStats,
  getAdminUsers,
  adminBanUser,
  adminUnbanUser,
  adminSuspendUser,
  adminChangeUserRole,
  getAdminSessions,
  adminForceEndSession,
  getPlatformConfig,
  updatePlatformConfig,
  getAdminAuditLog,
} from '@/lib/actions/admin'

const ADMIN_USER = { id: 'admin-uuid', role: 'ADMIN', username: 'admin' }
const TARGET_USER = { id: 'target-uuid', role: 'USER', username: 'testuser', banned_at: null }

function mockAdminAuth() {
  ;(requireAdmin as unknown as MockInstance).mockResolvedValue(ADMIN_USER)
}

describe('getAdminDashboardStats', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns aggregate counts', async () => {
    mockAdminAuth()
    ;(prisma.user.count as unknown as MockInstance)
      .mockResolvedValueOnce(100)  // totalUsers
      .mockResolvedValueOnce(90)   // activeUsers
      .mockResolvedValueOnce(5)    // recentSignups
    ;(prisma.session.count as unknown as MockInstance)
      .mockResolvedValueOnce(3)    // liveSessions
      .mockResolvedValueOnce(50)   // totalSessions

    const stats = await getAdminDashboardStats()

    expect(stats.totalUsers).toBe(100)
    expect(stats.activeUsers).toBe(90)
    expect(stats.liveSessions).toBe(3)
    expect(stats.totalSessions).toBe(50)
    expect(stats.recentSignups).toBe(5)
  })

  it('requires admin auth', async () => {
    ;(requireAdmin as unknown as MockInstance).mockRejectedValue(new Error('Not authorized'))
    await expect(getAdminDashboardStats()).rejects.toThrow('Not authorized')
  })
})

describe('getAdminUsers', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns paginated user list', async () => {
    mockAdminAuth()
    const users = [{ id: '1', username: 'user1' }, { id: '2', username: 'user2' }]
    ;(prisma.user.findMany as unknown as MockInstance).mockResolvedValue(users)
    ;(prisma.user.count as unknown as MockInstance).mockResolvedValue(2)

    const result = await getAdminUsers({ page: 1, limit: 20 })

    expect(result.users).toEqual(users)
    expect(result.total).toBe(2)
    expect(result.page).toBe(1)
    expect(result.totalPages).toBe(1)
  })

  it('passes search filter to Prisma', async () => {
    mockAdminAuth()
    ;(prisma.user.findMany as unknown as MockInstance).mockResolvedValue([])
    ;(prisma.user.count as unknown as MockInstance).mockResolvedValue(0)

    await getAdminUsers({ search: 'test', page: 1, limit: 20 })

    const findManyCall = (prisma.user.findMany as unknown as MockInstance).mock.calls[0][0]
    expect(findManyCall.where.OR).toBeDefined()
    expect(findManyCall.where.OR[0].username.contains).toBe('test')
  })
})

describe('adminBanUser', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('bans user in transaction', async () => {
    mockAdminAuth()
    ;(prisma.user.findUnique as unknown as MockInstance).mockResolvedValue({ ...TARGET_USER })
    ;(prisma.$transaction as unknown as MockInstance).mockResolvedValue(undefined)

    await adminBanUser(TARGET_USER.id, 'Spam')

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    const transactionArgs = (prisma.$transaction as unknown as MockInstance).mock.calls[0][0]
    expect(transactionArgs).toHaveLength(2)
  })

  it('rejects banning self', async () => {
    mockAdminAuth()
    await expect(adminBanUser(ADMIN_USER.id, 'test')).rejects.toThrow('Cannot ban yourself')
  })

  it('rejects banning already-banned user', async () => {
    mockAdminAuth()
    ;(prisma.user.findUnique as unknown as MockInstance).mockResolvedValue({
      ...TARGET_USER,
      banned_at: new Date(),
    })
    await expect(adminBanUser(TARGET_USER.id, 'Spam')).rejects.toThrow('already banned')
  })

  it('rejects banning nonexistent user', async () => {
    mockAdminAuth()
    ;(prisma.user.findUnique as unknown as MockInstance).mockResolvedValue(null)
    await expect(adminBanUser('nonexistent', 'Spam')).rejects.toThrow('User not found')
  })
})

describe('adminUnbanUser', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('unbans user in transaction', async () => {
    mockAdminAuth()
    ;(prisma.user.findUnique as unknown as MockInstance).mockResolvedValue({
      ...TARGET_USER,
      banned_at: new Date(),
    })
    ;(prisma.$transaction as unknown as MockInstance).mockResolvedValue(undefined)

    await adminUnbanUser(TARGET_USER.id)

    expect(prisma.$transaction).toHaveBeenCalled()
  })

  it('rejects unbanning non-banned user', async () => {
    mockAdminAuth()
    ;(prisma.user.findUnique as unknown as MockInstance).mockResolvedValue({ ...TARGET_USER })
    await expect(adminUnbanUser(TARGET_USER.id)).rejects.toThrow('not banned')
  })
})

describe('adminSuspendUser', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('suspends user with future date', async () => {
    mockAdminAuth()
    ;(prisma.user.findUnique as unknown as MockInstance).mockResolvedValue({ ...TARGET_USER })
    ;(prisma.$transaction as unknown as MockInstance).mockResolvedValue(undefined)

    const futureDate = new Date(Date.now() + 7 * 86400000).toISOString()
    await adminSuspendUser(TARGET_USER.id, futureDate, 'Misbehavior')

    expect(prisma.$transaction).toHaveBeenCalled()
  })

  it('rejects past suspension date', async () => {
    mockAdminAuth()
    const pastDate = new Date(Date.now() - 86400000).toISOString()
    ;(prisma.user.findUnique as unknown as MockInstance).mockResolvedValue({ ...TARGET_USER })
    await expect(adminSuspendUser(TARGET_USER.id, pastDate, 'test')).rejects.toThrow('future')
  })

  it('rejects suspending self', async () => {
    mockAdminAuth()
    const futureDate = new Date(Date.now() + 86400000).toISOString()
    await expect(adminSuspendUser(ADMIN_USER.id, futureDate, 'test')).rejects.toThrow('Cannot suspend yourself')
  })
})

describe('adminChangeUserRole', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('changes role successfully', async () => {
    mockAdminAuth()
    ;(prisma.user.findUnique as unknown as MockInstance).mockResolvedValue({ ...TARGET_USER })
    ;(prisma.$transaction as unknown as MockInstance).mockResolvedValue(undefined)

    await adminChangeUserRole(TARGET_USER.id, 'ADMIN')

    expect(prisma.$transaction).toHaveBeenCalled()
  })

  it('rejects changing own role', async () => {
    mockAdminAuth()
    await expect(adminChangeUserRole(ADMIN_USER.id, 'USER')).rejects.toThrow('Cannot change your own role')
  })

  it('rejects when user already has target role', async () => {
    mockAdminAuth()
    ;(prisma.user.findUnique as unknown as MockInstance).mockResolvedValue({ ...TARGET_USER })
    await expect(adminChangeUserRole(TARGET_USER.id, 'USER')).rejects.toThrow('already has this role')
  })
})

describe('getAdminSessions', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns paginated session list', async () => {
    mockAdminAuth()
    const sessions = [{ id: 's1', name: 'Test', status: 'LIVE' }]
    ;(prisma.session.findMany as unknown as MockInstance).mockResolvedValue(sessions)
    ;(prisma.session.count as unknown as MockInstance).mockResolvedValue(1)

    const result = await getAdminSessions({ page: 1, limit: 20 })

    expect(result.sessions).toEqual(sessions)
    expect(result.total).toBe(1)
  })

  it('filters by status', async () => {
    mockAdminAuth()
    ;(prisma.session.findMany as unknown as MockInstance).mockResolvedValue([])
    ;(prisma.session.count as unknown as MockInstance).mockResolvedValue(0)

    await getAdminSessions({ status: 'LIVE', page: 1, limit: 20 })

    const findManyCall = (prisma.session.findMany as unknown as MockInstance).mock.calls[0][0]
    expect(findManyCall.where.status).toBe('LIVE')
  })
})

describe('adminForceEndSession', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('ends session in transaction', async () => {
    mockAdminAuth()
    ;(prisma.session.findUnique as unknown as MockInstance).mockResolvedValue({
      id: 's1', status: 'LIVE', name: 'Test', code: 'ABC123',
    })
    ;(prisma.$transaction as unknown as MockInstance).mockResolvedValue(undefined)

    await adminForceEndSession('s1')

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    const transactionArgs = (prisma.$transaction as unknown as MockInstance).mock.calls[0][0]
    expect(transactionArgs).toHaveLength(3)
  })

  it('rejects ending already-ended session', async () => {
    mockAdminAuth()
    ;(prisma.session.findUnique as unknown as MockInstance).mockResolvedValue({
      id: 's1', status: 'ENDED', name: 'Test', code: 'ABC123',
    })
    await expect(adminForceEndSession('s1')).rejects.toThrow('already ended')
  })

  it('rejects ending nonexistent session', async () => {
    mockAdminAuth()
    ;(prisma.session.findUnique as unknown as MockInstance).mockResolvedValue(null)
    await expect(adminForceEndSession('nonexistent')).rejects.toThrow('Session not found')
  })
})

describe('getPlatformConfig', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns config via upsert', async () => {
    mockAdminAuth()
    const config = {
      id: 'singleton',
      default_turn_length: 120,
      default_audience_cap: 10,
      max_turn_length: 1800,
      max_audience_cap: 1000,
      allow_new_sessions: true,
      maintenance_message: null,
      updated_at: new Date(),
    }
    ;(prisma.platformConfig.upsert as unknown as MockInstance).mockResolvedValue(config)

    const result = await getPlatformConfig()

    expect(result).toEqual(config)
    expect(prisma.platformConfig.upsert).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      create: {},
      update: {},
    })
  })
})

describe('updatePlatformConfig', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('updates config and creates audit log', async () => {
    mockAdminAuth()
    const updatedConfig = {
      id: 'singleton',
      default_turn_length: 180,
      default_audience_cap: 20,
      max_turn_length: 1800,
      max_audience_cap: 1000,
      allow_new_sessions: true,
      maintenance_message: null,
      updated_at: new Date(),
    }
    ;(prisma.platformConfig.upsert as unknown as MockInstance).mockResolvedValue(updatedConfig)
    ;(prisma.adminAuditLog.create as unknown as MockInstance).mockResolvedValue({})

    const result = await updatePlatformConfig({
      default_turn_length: 180,
      default_audience_cap: 20,
    })

    expect(result).toEqual(updatedConfig)
    expect(prisma.adminAuditLog.create).toHaveBeenCalled()
  })

  it('rejects invalid turn length', async () => {
    mockAdminAuth()
    await expect(updatePlatformConfig({ default_turn_length: 5 })).rejects.toThrow()
  })

  it('rejects negative audience cap', async () => {
    mockAdminAuth()
    await expect(updatePlatformConfig({ default_audience_cap: -1 })).rejects.toThrow()
  })
})

describe('getAdminAuditLog', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns paginated audit entries', async () => {
    mockAdminAuth()
    const entries = [
      { id: 'a1', action: 'BAN_USER', target_type: 'User', target_id: 'u1', details: {}, created_at: new Date(), admin: { username: 'admin' } },
    ]
    ;(prisma.adminAuditLog.findMany as unknown as MockInstance).mockResolvedValue(entries)
    ;(prisma.adminAuditLog.count as unknown as MockInstance).mockResolvedValue(1)

    const result = await getAdminAuditLog({ page: 1, limit: 20 })

    expect(result.entries).toEqual(entries)
    expect(result.total).toBe(1)
    expect(result.totalPages).toBe(1)
  })
})
