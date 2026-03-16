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
    },
  },
}))

import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { ensureUserProfile } from '@/lib/actions/user'

function mockAuth(user: { id: string; email?: string } | null) {
  ;(createClient as any).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
      }),
    },
  })
}

const MOCK_USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

describe('ensureUserProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when not authenticated', async () => {
    mockAuth(null)
    const result = await ensureUserProfile()
    expect(result).toBeNull()
    expect(prisma.user.upsert).not.toHaveBeenCalled()
  })

  it('derives username from email prefix', async () => {
    mockAuth({ id: MOCK_USER_ID, email: 'alice@example.com' })
    ;(prisma.user.findUnique as any).mockResolvedValue(null)
    ;(prisma.user.upsert as any).mockResolvedValue({
      id: MOCK_USER_ID,
      username: 'alice',
      email: 'alice@example.com',
    })

    await ensureUserProfile()

    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          id: MOCK_USER_ID,
          username: 'alice',
          email: 'alice@example.com',
        }),
      })
    )
  })

  it('falls back to user-<id> when email has no prefix', async () => {
    mockAuth({ id: MOCK_USER_ID, email: '' })
    ;(prisma.user.findUnique as any).mockResolvedValue(null)
    ;(prisma.user.upsert as any).mockResolvedValue({
      id: MOCK_USER_ID,
      username: `user-${MOCK_USER_ID.slice(0, 8)}`,
    })

    await ensureUserProfile()

    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          username: `user-${MOCK_USER_ID.slice(0, 8)}`,
        }),
      })
    )
  })

  it('falls back to user-<id> when email is undefined', async () => {
    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.findUnique as any).mockResolvedValue(null)
    ;(prisma.user.upsert as any).mockResolvedValue({
      id: MOCK_USER_ID,
      username: `user-${MOCK_USER_ID.slice(0, 8)}`,
    })

    await ensureUserProfile()

    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          username: `user-${MOCK_USER_ID.slice(0, 8)}`,
        }),
      })
    )
  })

  it('appends suffix on username collision', async () => {
    mockAuth({ id: MOCK_USER_ID, email: 'bob@example.com' })
    // First findUnique: 'bob' exists (owned by someone else)
    ;(prisma.user.findUnique as any)
      .mockResolvedValueOnce({ id: 'other-user', username: 'bob' })
    // findFirst: 'bob' is NOT ours
    ;(prisma.user.findFirst as any)
      .mockResolvedValueOnce(null)
    // Second findUnique: 'bob-1' is free
    ;(prisma.user.findUnique as any)
      .mockResolvedValueOnce(null)
    ;(prisma.user.upsert as any).mockResolvedValue({
      id: MOCK_USER_ID,
      username: 'bob-1',
    })

    await ensureUserProfile()

    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ username: 'bob-1' }),
      })
    )
  })

  it('skips collision loop when existing username belongs to same user', async () => {
    mockAuth({ id: MOCK_USER_ID, email: 'carol@example.com' })
    // findUnique: 'carol' exists
    ;(prisma.user.findUnique as any)
      .mockResolvedValueOnce({ id: MOCK_USER_ID, username: 'carol' })
    // findFirst: it IS ours → break
    ;(prisma.user.findFirst as any)
      .mockResolvedValueOnce({ id: MOCK_USER_ID, username: 'carol' })
    ;(prisma.user.upsert as any).mockResolvedValue({
      id: MOCK_USER_ID,
      username: 'carol',
    })

    await ensureUserProfile()

    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ username: 'carol' }),
      })
    )
  })

  it('uses upsert with correct where clause', async () => {
    mockAuth({ id: MOCK_USER_ID, email: 'test@example.com' })
    ;(prisma.user.findUnique as any).mockResolvedValue(null)
    ;(prisma.user.upsert as any).mockResolvedValue({ id: MOCK_USER_ID })

    await ensureUserProfile()

    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MOCK_USER_ID },
        update: {},
      })
    )
  })

  it('returns the upserted user record', async () => {
    const mockUser = { id: MOCK_USER_ID, username: 'test', email: 'test@x.com' }
    mockAuth({ id: MOCK_USER_ID, email: 'test@x.com' })
    ;(prisma.user.findUnique as any).mockResolvedValue(null)
    ;(prisma.user.upsert as any).mockResolvedValue(mockUser)

    const result = await ensureUserProfile()
    expect(result).toEqual(mockUser)
  })
})
