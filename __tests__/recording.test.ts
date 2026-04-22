import { describe, it, expect, vi, beforeEach } from 'vitest'

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
    recording: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import {
  createRecording,
  getRecordingsBySession,
  deleteRecording,
} from '@/lib/actions/recording'

const MOCK_USER_ID = 'user-uuid-1234'
const MOCK_HOST_ID = 'host-uuid-5678'
const MOCK_SESSION_ID = 'session-cuid-5678'
const MOCK_RECORDING_ID = 'recording-id-1234'

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

// ── createRecording ──
describe('createRecording', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    ;(prisma.session.findUnique as any).mockResolvedValue({
      id: MOCK_SESSION_ID,
      host_id: MOCK_USER_ID,
      moderator_id: null,
    })
    ;(prisma.recording.create as any).mockResolvedValue({
      id: MOCK_RECORDING_ID,
    })
  })

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(
      createRecording(MOCK_SESSION_ID, 'https://example.com/recording.mp4')
    ).rejects.toThrow('Not authenticated')
  })

  it('throws "Session not found"', async () => {
    ;(prisma.session.findUnique as any).mockResolvedValue(null)
    await expect(
      createRecording(MOCK_SESSION_ID, 'https://example.com/recording.mp4')
    ).rejects.toThrow('Session not found')
  })

  it('throws "Not authorized" when not host/moderator', async () => {
    ;(prisma.session.findUnique as any).mockResolvedValue({
      id: MOCK_SESSION_ID,
      host_id: 'other-user',
      moderator_id: null,
    })
    await expect(
      createRecording(MOCK_SESSION_ID, 'https://example.com/recording.mp4')
    ).rejects.toThrow('Not authorized')
  })

  it('calls prisma.recording.create on success', async () => {
    await createRecording(MOCK_SESSION_ID, 'https://example.com/recording.mp4', 3600, 1024000, 'video/mp4')
    expect(prisma.recording.create).toHaveBeenCalledWith({
      data: {
        session_id: MOCK_SESSION_ID,
        recorded_by: MOCK_USER_ID,
        url: 'https://example.com/recording.mp4',
        duration: 3600,
        file_size: 1024000,
        mime_type: 'video/mp4',
      },
    })
  })

  it('calls prisma.recording.create with null for optional fields', async () => {
    await createRecording(MOCK_SESSION_ID, 'https://example.com/recording.mp4')
    expect(prisma.recording.create).toHaveBeenCalledWith({
      data: {
        session_id: MOCK_SESSION_ID,
        recorded_by: MOCK_USER_ID,
        url: 'https://example.com/recording.mp4',
        duration: null,
        file_size: null,
        mime_type: null,
      },
    })
  })

  it('allows moderator to create recording', async () => {
    ;(prisma.session.findUnique as any).mockResolvedValue({
      id: MOCK_SESSION_ID,
      host_id: 'other-user',
      moderator_id: MOCK_USER_ID,
    })
    await createRecording(MOCK_SESSION_ID, 'https://example.com/recording.mp4')
    expect(prisma.recording.create).toHaveBeenCalled()
  })
})

// ── getRecordingsBySession ──
describe('getRecordingsBySession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: MOCK_USER_ID,
      session_id: MOCK_SESSION_ID,
      left_at: null,
    })
    ;(prisma.recording.findMany as any).mockResolvedValue([])
  })

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(getRecordingsBySession(MOCK_SESSION_ID)).rejects.toThrow('Not authenticated')
  })

  it('throws "Not a participant"', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue(null)
    await expect(getRecordingsBySession(MOCK_SESSION_ID)).rejects.toThrow('Not a participant in this session')
  })

  it('returns recordings ordered by created_at desc', async () => {
    await getRecordingsBySession(MOCK_SESSION_ID)
    expect(prisma.recording.findMany).toHaveBeenCalledWith({
      where: { session_id: MOCK_SESSION_ID },
      orderBy: { created_at: 'desc' },
      include: {
        recorder: { select: { id: true, username: true, realname: true } },
      },
    })
  })
})

// ── deleteRecording ──
describe('deleteRecording', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    ;(prisma.recording.findUnique as any).mockResolvedValue({
      id: MOCK_RECORDING_ID,
      recorded_by: MOCK_USER_ID,
      session: { host_id: MOCK_HOST_ID },
    })
    ;(prisma.recording.delete as any).mockResolvedValue({})
  })

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(deleteRecording(MOCK_RECORDING_ID)).rejects.toThrow('Not authenticated')
  })

  it('throws "Recording not found"', async () => {
    ;(prisma.recording.findUnique as any).mockResolvedValue(null)
    await expect(deleteRecording(MOCK_RECORDING_ID)).rejects.toThrow('Recording not found')
  })

  it('throws "Not authorized" when user is not recorder and not host', async () => {
    ;(prisma.recording.findUnique as any).mockResolvedValue({
      id: MOCK_RECORDING_ID,
      recorded_by: 'other-user',
      session: { host_id: 'other-host' },
    })
    await expect(deleteRecording(MOCK_RECORDING_ID)).rejects.toThrow('Not authorized to delete this recording')
  })

  it('calls prisma.recording.delete when user is recorder', async () => {
    await deleteRecording(MOCK_RECORDING_ID)
    expect(prisma.recording.delete).toHaveBeenCalledWith({
      where: { id: MOCK_RECORDING_ID },
    })
  })

  it('calls prisma.recording.delete when user is host (even if not recorder)', async () => {
    mockAuth(MOCK_HOST_ID)
    ;(prisma.recording.findUnique as any).mockResolvedValue({
      id: MOCK_RECORDING_ID,
      recorded_by: 'other-user',
      session: { host_id: MOCK_HOST_ID },
    })
    await deleteRecording(MOCK_RECORDING_ID)
    expect(prisma.recording.delete).toHaveBeenCalledWith({
      where: { id: MOCK_RECORDING_ID },
    })
  })
})
