import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getUserPreferences, updateUserPreferences } from '@/lib/actions/user'

function mockAuth(user: { id: string } | null) {
  ;(createClient as any).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
      }),
    },
  })
}

const MOCK_USER_ID = 'user-uuid-1234'

describe('getUserPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(getUserPreferences()).rejects.toThrow('Not authenticated')
  })

  it('returns user preferences when authenticated', async () => {
    const mockPreferences = {
      username: 'testuser',
      email: 'test@example.com',
      realname: 'Test User',
      bio: 'Test bio',
      notify_invitations: true,
      notify_messages: true,
      notify_weekly_digest: false,
      profile_visibility: 'public',
      show_online_status: true,
      allow_direct_messages: true,
      theme: 'dark',
      font_size: 'medium',
      animations_enabled: true,
      language: 'en',
      timezone: 'America/Toronto',
      date_format: 'YYYY-MM-DD',
    }

    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.findUnique as any).mockResolvedValue(mockPreferences)

    const result = await getUserPreferences()

    expect(result).toEqual(mockPreferences)
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: MOCK_USER_ID },
      select: {
        username: true,
        email: true,
        realname: true,
        bio: true,
        notify_invitations: true,
        notify_messages: true,
        notify_weekly_digest: true,
        profile_visibility: true,
        show_online_status: true,
        allow_direct_messages: true,
        theme: true,
        font_size: true,
        animations_enabled: true,
        language: true,
        timezone: true,
        date_format: true,
      },
    })
  })
})

describe('updateUserPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(updateUserPreferences({ bio: 'test' })).rejects.toThrow('Not authenticated')
  })

  it('throws when invalid theme value', async () => {
    mockAuth({ id: MOCK_USER_ID })
    await expect(updateUserPreferences({ theme: 'invalid' })).rejects.toThrow(
      "Theme must be 'dark', 'light', or 'system'"
    )
  })

  it('throws when invalid font_size', async () => {
    mockAuth({ id: MOCK_USER_ID })
    await expect(updateUserPreferences({ font_size: 'huge' })).rejects.toThrow(
      "Font size must be 'small', 'medium', or 'large'"
    )
  })

  it('throws when invalid profile_visibility', async () => {
    mockAuth({ id: MOCK_USER_ID })
    await expect(updateUserPreferences({ profile_visibility: 'hidden' })).rejects.toThrow(
      "Profile visibility must be 'public' or 'private'"
    )
  })

  it('updates successfully with valid partial data', async () => {
    const updateData = {
      bio: 'Updated bio',
      notify_invitations: false,
    }
    const mockUpdatedUser = {
      id: MOCK_USER_ID,
      username: 'testuser',
      ...updateData,
    }

    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.update as any).mockResolvedValue(mockUpdatedUser)

    const result = await updateUserPreferences(updateData)

    expect(result).toEqual(mockUpdatedUser)
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: MOCK_USER_ID },
      data: updateData,
    })
  })

  it('updates with all fields', async () => {
    const updateData = {
      bio: 'Full update bio',
      notify_invitations: true,
      notify_messages: false,
      notify_weekly_digest: true,
      profile_visibility: 'private',
      show_online_status: false,
      allow_direct_messages: true,
      theme: 'light',
      font_size: 'large',
      animations_enabled: false,
      language: 'fr',
      timezone: 'Europe/Paris',
      date_format: 'DD/MM/YYYY',
    }
    const mockUpdatedUser = {
      id: MOCK_USER_ID,
      username: 'testuser',
      email: 'test@example.com',
      ...updateData,
    }

    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.update as any).mockResolvedValue(mockUpdatedUser)

    const result = await updateUserPreferences(updateData)

    expect(result).toEqual(mockUpdatedUser)
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: MOCK_USER_ID },
      data: updateData,
    })
  })

  it('accepts valid theme values', async () => {
    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.update as any).mockResolvedValue({ id: MOCK_USER_ID })

    await expect(updateUserPreferences({ theme: 'dark' })).resolves.not.toThrow()
    await expect(updateUserPreferences({ theme: 'light' })).resolves.not.toThrow()
    await expect(updateUserPreferences({ theme: 'system' })).resolves.not.toThrow()
  })

  it('accepts valid font_size values', async () => {
    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.update as any).mockResolvedValue({ id: MOCK_USER_ID })

    await expect(updateUserPreferences({ font_size: 'small' })).resolves.not.toThrow()
    await expect(updateUserPreferences({ font_size: 'medium' })).resolves.not.toThrow()
    await expect(updateUserPreferences({ font_size: 'large' })).resolves.not.toThrow()
  })

  it('accepts valid profile_visibility values', async () => {
    mockAuth({ id: MOCK_USER_ID })
    ;(prisma.user.update as any).mockResolvedValue({ id: MOCK_USER_ID })

    await expect(updateUserPreferences({ profile_visibility: 'public' })).resolves.not.toThrow()
    await expect(updateUserPreferences({ profile_visibility: 'private' })).resolves.not.toThrow()
  })
})
