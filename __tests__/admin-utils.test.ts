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
import { requireAuth, requireAdmin } from '@/lib/actions/utils'

function mockAuth(user: { id: string } | null) {
  ;(createClient as unknown as MockInstance).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
      }),
    },
  })
}

const MOCK_USER_ID = 'user-uuid-1234'

describe('requireAuth — ban/suspend/delete enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws "Not authenticated" when no user', async () => {
    mockAuth(null)
    await expect(requireAuth()).rejects.toThrow('Not authenticated')
  })

  it('returns user when authenticated and account is active', async () => {
    const mockUser = { id: MOCK_USER_ID }
    mockAuth(mockUser)
    ;(prisma.user.findUnique as unknown as MockInstance).mockResolvedValue({
      banned_at: null,
      suspended_until: null,
      deleted_at: null,
    })
    const result = await requireAuth()
    expect(result).toEqual(mockUser)
  })

  it('returns user when db record not found (new user)', async () => {
    const mockUser = { id: MOCK_USER_ID }
    mockAuth(mockUser)
    ;(prisma.user.findUnique as unknown as MockInstance).mockResolvedValue(null)
    const result = await requireAuth()
    expect(result).toEqual(mockUser)
  })

  it('throws "Account has been banned" when user is banned', async () => {
    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.findUnique as unknown as MockInstance).mockResolvedValue({
      banned_at: new Date(),
      suspended_until: null,
      deleted_at: null,
    })
    await expect(requireAuth()).rejects.toThrow('Account has been banned')
  })

  it('throws "Account is suspended" when suspension is active', async () => {
    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.findUnique as unknown as MockInstance).mockResolvedValue({
      banned_at: null,
      suspended_until: new Date(Date.now() + 86400000), // tomorrow
      deleted_at: null,
    })
    await expect(requireAuth()).rejects.toThrow('Account is suspended')
  })

  it('allows login when suspension has expired', async () => {
    const mockUser = { id: MOCK_USER_ID }
    mockAuth(mockUser)
    ;(prisma.user.findUnique as unknown as MockInstance).mockResolvedValue({
      banned_at: null,
      suspended_until: new Date(Date.now() - 86400000), // yesterday
      deleted_at: null,
    })
    const result = await requireAuth()
    expect(result).toEqual(mockUser)
  })

  it('throws "Account has been deleted" when user is soft-deleted', async () => {
    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.findUnique as unknown as MockInstance).mockResolvedValue({
      banned_at: null,
      suspended_until: null,
      deleted_at: new Date(),
    })
    await expect(requireAuth()).rejects.toThrow('Account has been deleted')
  })
})

describe('requireAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(requireAdmin()).rejects.toThrow('Not authenticated')
  })

  it('throws "Not authorized" when user role is USER', async () => {
    mockAuth({ id: MOCK_USER_ID })
    // First findUnique call: requireAuth ban check
    ;(prisma.user.findUnique as unknown as MockInstance)
      .mockResolvedValueOnce({ banned_at: null, suspended_until: null, deleted_at: null })
      // Second findUnique call: requireAdmin role check
      .mockResolvedValueOnce({ id: MOCK_USER_ID, role: 'USER', username: 'testuser' })
    await expect(requireAdmin()).rejects.toThrow('Not authorized')
  })

  it('throws "Not authorized" when user not found in db', async () => {
    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.findUnique as unknown as MockInstance)
      .mockResolvedValueOnce({ banned_at: null, suspended_until: null, deleted_at: null })
      .mockResolvedValueOnce(null)
    await expect(requireAdmin()).rejects.toThrow('Not authorized')
  })

  it('returns Prisma user record when role is ADMIN', async () => {
    mockAuth({ id: MOCK_USER_ID })
    const adminUser = { id: MOCK_USER_ID, role: 'ADMIN', username: 'admin' }
    ;(prisma.user.findUnique as unknown as MockInstance)
      .mockResolvedValueOnce({ banned_at: null, suspended_until: null, deleted_at: null })
      .mockResolvedValueOnce(adminUser)
    const result = await requireAdmin()
    expect(result).toEqual(adminUser)
  })

  it('throws when banned user tries to access admin', async () => {
    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.findUnique as unknown as MockInstance).mockResolvedValue({
      banned_at: new Date(),
      suspended_until: null,
      deleted_at: null,
    })
    await expect(requireAdmin()).rejects.toThrow('Account has been banned')
  })
})
