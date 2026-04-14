import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    participatesIn: {
      deleteMany: vi.fn(),
    },
    session: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    debateState: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import {
  ensureUserProfile,
  getUserProfile,
  updateUserProfile,
  deleteAccount,
} from '@/lib/actions/user'
import { DEFAULT_PREFERENCES, preferencesSchema } from '@/lib/constants/preferences'
import { Prisma } from '@/lib/generated/prisma'

// ── Helpers ──
const MOCK_USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function mockAuth(user: { id: string; email?: string } | null) {
  const signOut = vi.fn().mockResolvedValue({})
  ;(createClient as any).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
      }),
      signOut,
    },
  })
  return { signOut }
}

function mockProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: MOCK_USER_ID,
    username: 'testuser',
    email: 'test@example.com',
    realname: null,
    bio: null,
    preferences: null,
    created_at: new Date(),
    deleted_at: null,
    ...overrides,
  }
}

// ── preferencesSchema ──
describe('preferencesSchema', () => {
  it('validates correct DEFAULT_PREFERENCES', () => {
    const result = preferencesSchema.safeParse(DEFAULT_PREFERENCES)
    expect(result.success).toBe(true)
  })

  it('rejects missing notifications section', () => {
    const invalid = { ...DEFAULT_PREFERENCES, notifications: undefined }
    const result = preferencesSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('rejects invalid profileVisibility value', () => {
    const invalid = {
      ...DEFAULT_PREFERENCES,
      privacy: { ...DEFAULT_PREFERENCES.privacy, profileVisibility: 'invalid' },
    }
    const result = preferencesSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('rejects invalid theme value', () => {
    const invalid = {
      ...DEFAULT_PREFERENCES,
      appearance: { ...DEFAULT_PREFERENCES.appearance, theme: 'neon' },
    }
    const result = preferencesSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('rejects invalid fontSize value', () => {
    const invalid = {
      ...DEFAULT_PREFERENCES,
      appearance: { ...DEFAULT_PREFERENCES.appearance, fontSize: 'huge' },
    }
    const result = preferencesSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('rejects invalid dateFormat value', () => {
    const invalid = {
      ...DEFAULT_PREFERENCES,
      language: { ...DEFAULT_PREFERENCES.language, dateFormat: 'YYYY/MM/DD' },
    }
    const result = preferencesSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('rejects non-boolean toggle values', () => {
    const invalid = {
      ...DEFAULT_PREFERENCES,
      notifications: { ...DEFAULT_PREFERENCES.notifications, debateInvitations: 'yes' },
    }
    const result = preferencesSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('accepts all valid profileVisibility options', () => {
    for (const vis of ['public', 'friends', 'private'] as const) {
      const prefs = {
        ...DEFAULT_PREFERENCES,
        privacy: { ...DEFAULT_PREFERENCES.privacy, profileVisibility: vis },
      }
      expect(preferencesSchema.safeParse(prefs).success).toBe(true)
    }
  })

  it('accepts all valid theme options', () => {
    for (const theme of ['dark', 'light', 'system'] as const) {
      const prefs = {
        ...DEFAULT_PREFERENCES,
        appearance: { ...DEFAULT_PREFERENCES.appearance, theme },
      }
      expect(preferencesSchema.safeParse(prefs).success).toBe(true)
    }
  })

  it('accepts all valid dateFormat options', () => {
    for (const fmt of ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'] as const) {
      const prefs = {
        ...DEFAULT_PREFERENCES,
        language: { ...DEFAULT_PREFERENCES.language, dateFormat: fmt },
      }
      expect(preferencesSchema.safeParse(prefs).success).toBe(true)
    }
  })
})

// ── ensureUserProfile (soft-delete check) ──
describe('ensureUserProfile — soft-delete', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when user is soft-deleted', async () => {
    mockAuth({ id: MOCK_USER_ID, email: 'deleted@example.com' })
    ;(prisma.user.findUnique as any).mockResolvedValue(null)
    ;(prisma.user.upsert as any).mockResolvedValue(
      mockProfile({ deleted_at: new Date() })
    )

    const result = await ensureUserProfile()
    expect(result).toBeNull()
  })

  it('returns user when not soft-deleted', async () => {
    mockAuth({ id: MOCK_USER_ID, email: 'active@example.com' })
    ;(prisma.user.findUnique as any).mockResolvedValue(null)
    const profile = mockProfile({ deleted_at: null })
    ;(prisma.user.upsert as any).mockResolvedValue(profile)

    const result = await ensureUserProfile()
    expect(result).toEqual(profile)
  })
})

// ── getUserProfile ──
describe('getUserProfile', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when not authenticated', async () => {
    mockAuth(null)
    const result = await getUserProfile()
    expect(result).toBeNull()
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('returns profile with correct select fields', async () => {
    mockAuth({ id: MOCK_USER_ID })
    const profile = mockProfile()
    ;(prisma.user.findUnique as any).mockResolvedValue(profile)

    const result = await getUserProfile()

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: MOCK_USER_ID },
      select: {
        id: true,
        username: true,
        email: true,
        realname: true,
        bio: true,
        preferences: true,
        created_at: true,
      },
    })
    expect(result).toEqual(profile)
  })

  it('returns null when user not found in database', async () => {
    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.findUnique as any).mockResolvedValue(null)

    const result = await getUserProfile()
    expect(result).toBeNull()
  })
})

// ── updateUserProfile ──
describe('updateUserProfile', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(updateUserProfile({ username: 'test' })).rejects.toThrow('Not authenticated')
  })

  // Username validation
  it('throws for empty username', async () => {
    mockAuth({ id: MOCK_USER_ID })
    await expect(updateUserProfile({ username: '   ' })).rejects.toThrow('Username cannot be empty')
  })

  it('throws for username shorter than 3 chars', async () => {
    mockAuth({ id: MOCK_USER_ID })
    await expect(updateUserProfile({ username: 'ab' })).rejects.toThrow(
      'Username must be at least 3 characters'
    )
  })

  it('throws for username longer than 30 chars', async () => {
    mockAuth({ id: MOCK_USER_ID })
    const long = 'a'.repeat(31)
    await expect(updateUserProfile({ username: long })).rejects.toThrow(
      'Username must be 30 characters or fewer'
    )
  })

  it('throws for username with invalid characters', async () => {
    mockAuth({ id: MOCK_USER_ID })
    await expect(updateUserProfile({ username: 'bad user!' })).rejects.toThrow(
      'Username can only contain letters, numbers, hyphens, and underscores'
    )
  })

  it('accepts valid username with hyphens and underscores', async () => {
    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.update as any).mockResolvedValue(mockProfile({ username: 'valid_user-1' }))

    const result = await updateUserProfile({ username: 'valid_user-1' })
    expect(result.success).toBe(true)
  })

  it('trims username before saving', async () => {
    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.update as any).mockResolvedValue(mockProfile({ username: 'trimmed' }))

    await updateUserProfile({ username: '  trimmed  ' })

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ username: 'trimmed' }),
      })
    )
  })

  // Bio validation
  it('throws for bio over 500 chars', async () => {
    mockAuth({ id: MOCK_USER_ID })
    const longBio = 'x'.repeat(501)
    await expect(updateUserProfile({ bio: longBio })).rejects.toThrow(
      'Bio must be 500 characters or fewer'
    )
  })

  it('accepts bio at exactly 500 chars', async () => {
    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.update as any).mockResolvedValue(mockProfile())
    const bio = 'x'.repeat(500)
    await expect(updateUserProfile({ bio })).resolves.toBeDefined()
  })

  it('saves empty bio as null', async () => {
    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.update as any).mockResolvedValue(mockProfile())

    await updateUserProfile({ bio: '   ' })

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bio: null }),
      })
    )
  })

  // Preferences validation
  it('throws for invalid preferences', async () => {
    mockAuth({ id: MOCK_USER_ID })
    await expect(
      updateUserProfile({ preferences: { bad: 'data' } as any })
    ).rejects.toThrow('Invalid preferences')
  })

  it('accepts valid preferences', async () => {
    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.update as any).mockResolvedValue(mockProfile())

    await expect(
      updateUserProfile({ preferences: DEFAULT_PREFERENCES })
    ).resolves.toBeDefined()
  })

  // Realname
  it('saves empty realname as null', async () => {
    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.update as any).mockResolvedValue(mockProfile())

    await updateUserProfile({ realname: '   ' })

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ realname: null }),
      })
    )
  })

  // P2002 unique constraint
  it('throws friendly message on duplicate username (P2002)', async () => {
    mockAuth({ id: MOCK_USER_ID })
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '7.0.0',
    })
    ;(prisma.user.update as any).mockRejectedValue(p2002)

    await expect(updateUserProfile({ username: 'taken' })).rejects.toThrow(
      'Username already taken'
    )
  })

  it('rethrows non-P2002 Prisma errors', async () => {
    mockAuth({ id: MOCK_USER_ID })
    const otherError = new Error('DB connection failed')
    ;(prisma.user.update as any).mockRejectedValue(otherError)

    await expect(updateUserProfile({ username: 'valid' })).rejects.toThrow(
      'DB connection failed'
    )
  })

  // Partial update (only provided fields)
  it('only updates provided fields', async () => {
    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.update as any).mockResolvedValue(mockProfile())

    await updateUserProfile({ bio: 'new bio' })

    const updateCall = (prisma.user.update as any).mock.calls[0][0]
    expect(updateCall.data).toHaveProperty('bio')
    expect(updateCall.data).not.toHaveProperty('username')
    expect(updateCall.data).not.toHaveProperty('realname')
    expect(updateCall.data).not.toHaveProperty('preferences')
  })

  it('returns success with updated user', async () => {
    mockAuth({ id: MOCK_USER_ID })
    const updated = mockProfile({ username: 'newname' })
    ;(prisma.user.update as any).mockResolvedValue(updated)

    const result = await updateUserProfile({ username: 'newname' })
    expect(result).toEqual({ success: true, user: updated })
  })
})

// ── deleteAccount ──
describe('deleteAccount', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(deleteAccount()).rejects.toThrow('Not authenticated')
  })

  it('executes soft-delete transaction and signs out', async () => {
    const { signOut } = mockAuth({ id: MOCK_USER_ID })

    // Mock $transaction to execute the callback with mock tx
    const mockTx = {
      user: { update: vi.fn() },
      participatesIn: { deleteMany: vi.fn() },
      session: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn(), deleteMany: vi.fn() },
      debateState: { deleteMany: vi.fn() },
    }
    ;(prisma.$transaction as any).mockImplementation(async (cb: any) => cb(mockTx))

    await deleteAccount()

    // Verify soft-delete
    expect(mockTx.user.update).toHaveBeenCalledWith({
      where: { id: MOCK_USER_ID },
      data: { deleted_at: expect.any(Date) },
    })

    // Verify participations cleaned up
    expect(mockTx.participatesIn.deleteMany).toHaveBeenCalledWith({
      where: { user_id: MOCK_USER_ID },
    })

    // Verify moderator unset
    expect(mockTx.session.updateMany).toHaveBeenCalledWith({
      where: { moderator_id: MOCK_USER_ID },
      data: { moderator_id: null },
    })

    // Verify sign out
    expect(signOut).toHaveBeenCalled()
  })

  it('cleans up hosted sessions and their dependents', async () => {
    mockAuth({ id: MOCK_USER_ID })

    const hostedSessions = [{ id: 'session-1' }, { id: 'session-2' }]
    const mockTx = {
      user: { update: vi.fn() },
      participatesIn: { deleteMany: vi.fn() },
      session: {
        findMany: vi.fn().mockResolvedValue(hostedSessions),
        updateMany: vi.fn(),
        deleteMany: vi.fn(),
      },
      debateState: { deleteMany: vi.fn() },
    }
    ;(prisma.$transaction as any).mockImplementation(async (cb: any) => cb(mockTx))

    await deleteAccount()

    // Verify debate states deleted for hosted sessions
    expect(mockTx.debateState.deleteMany).toHaveBeenCalledWith({
      where: { session_id: { in: ['session-1', 'session-2'] } },
    })

    // Verify other participants' records deleted
    expect(mockTx.participatesIn.deleteMany).toHaveBeenCalledWith({
      where: { session_id: { in: ['session-1', 'session-2'] } },
    })

    // Verify hosted sessions deleted
    expect(mockTx.session.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['session-1', 'session-2'] } },
    })
  })

  it('skips session cleanup when user has no hosted sessions', async () => {
    mockAuth({ id: MOCK_USER_ID })

    const mockTx = {
      user: { update: vi.fn() },
      participatesIn: { deleteMany: vi.fn() },
      session: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
        deleteMany: vi.fn(),
      },
      debateState: { deleteMany: vi.fn() },
    }
    ;(prisma.$transaction as any).mockImplementation(async (cb: any) => cb(mockTx))

    await deleteAccount()

    expect(mockTx.debateState.deleteMany).not.toHaveBeenCalled()
    expect(mockTx.session.deleteMany).not.toHaveBeenCalled()
  })
})

// ── DEFAULT_PREFERENCES ──
describe('DEFAULT_PREFERENCES', () => {
  it('has all expected sections', () => {
    expect(DEFAULT_PREFERENCES).toHaveProperty('notifications')
    expect(DEFAULT_PREFERENCES).toHaveProperty('privacy')
    expect(DEFAULT_PREFERENCES).toHaveProperty('appearance')
    expect(DEFAULT_PREFERENCES).toHaveProperty('language')
  })

  it('has sensible default values', () => {
    expect(DEFAULT_PREFERENCES.notifications.debateInvitations).toBe(true)
    expect(DEFAULT_PREFERENCES.notifications.weeklyDigest).toBe(false)
    expect(DEFAULT_PREFERENCES.privacy.profileVisibility).toBe('public')
    expect(DEFAULT_PREFERENCES.appearance.theme).toBe('dark')
    expect(DEFAULT_PREFERENCES.appearance.fontSize).toBe('medium')
    expect(DEFAULT_PREFERENCES.language.dateFormat).toBe('MM/DD/YYYY')
  })
})
