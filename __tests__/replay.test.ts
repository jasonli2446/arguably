import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest'

// ── Mocks ──

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    session: { findUnique: vi.fn() },
    turnLog: { findMany: vi.fn() },
    transcript: { findMany: vi.fn() },
    participatesIn: { findMany: vi.fn() },
  },
}))

import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getReplayData, getSessionAnalytics, exportAnalyticsCsv } from '@/lib/actions/replay'

const MOCK_USER_ID = 'user-uuid-1234'
const MOCK_SESSION_CODE = 'ARG-1234'
const MOCK_SESSION_ID = 'session-cuid-5678'

function mockAuth(userId: string | null) {
  ;(createClient as MockInstance).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  })
  if (userId) {
    ;(prisma.user.findUnique as MockInstance).mockResolvedValue({
      banned_at: null,
      suspended_until: null,
      deleted_at: null,
    })
  }
}

function mockEndedSession() {
  ;(prisma.session.findUnique as MockInstance).mockResolvedValue({
    id: MOCK_SESSION_ID,
    code: MOCK_SESSION_CODE,
    name: 'Test Debate',
    description: null,
    type: 'ONE_ON_ONE',
    status: 'ENDED',
    turn_length: 120,
    created_at: new Date('2024-01-01T00:00:00Z'),
    ended_at: new Date('2024-01-01T01:00:00Z'),
    host: { id: 'host-id', username: 'host', realname: 'Host User' },
    moderator: null,
  })
}

function mockTurnLogs() {
  ;(prisma.turnLog.findMany as MockInstance).mockResolvedValue([
    {
      id: 'tl1',
      speaker_user_id: 'u1',
      speaker_name: 'Alice',
      turn_index: 0,
      reason: 'DEBATE_START',
      started_at: new Date('2024-01-01T00:10:00Z'),
      ended_at: new Date('2024-01-01T00:10:00Z'),
      duration_sec: 0,
    },
    {
      id: 'tl2',
      speaker_user_id: 'u1',
      speaker_name: 'Alice',
      turn_index: 0,
      reason: 'TIMER_EXPIRED',
      started_at: new Date('2024-01-01T00:10:00Z'),
      ended_at: new Date('2024-01-01T00:12:00Z'),
      duration_sec: 120,
    },
    {
      id: 'tl3',
      speaker_user_id: 'u2',
      speaker_name: 'Bob',
      turn_index: 1,
      reason: 'MANUAL_ADVANCE',
      started_at: new Date('2024-01-01T00:12:00Z'),
      ended_at: new Date('2024-01-01T00:14:00Z'),
      duration_sec: 120,
    },
  ])
}

function mockTranscripts() {
  ;(prisma.transcript.findMany as MockInstance).mockResolvedValue([
    {
      id: 'tr1',
      speaker_id: 'u1',
      content: 'Hello world this is Alice',
      timestamp: 5,
      duration: 3,
      speaker: { id: 'u1', username: 'alice', realname: 'Alice Smith' },
    },
    {
      id: 'tr2',
      speaker_id: 'u2',
      content: 'And this is Bob',
      timestamp: 125,
      duration: 2,
      speaker: { id: 'u2', username: 'bob', realname: 'Bob Jones' },
    },
  ])
}

function mockParticipants() {
  ;(prisma.participatesIn.findMany as MockInstance).mockResolvedValue([
    {
      user_id: 'u1',
      session_role: 'DEBATER',
      user: { id: 'u1', username: 'alice', realname: 'Alice Smith' },
    },
    {
      user_id: 'u2',
      session_role: 'DEBATER',
      user: { id: 'u2', username: 'bob', realname: 'Bob Jones' },
    },
    {
      user_id: 'host-id',
      session_role: 'HOST',
      user: { id: 'host-id', username: 'host', realname: 'Host User' },
    },
  ])
}

// ── getReplayData ──

describe('getReplayData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    mockEndedSession()
    mockTurnLogs()
    mockTranscripts()
    mockParticipants()
  })

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(getReplayData(MOCK_SESSION_CODE)).rejects.toThrow('Not authenticated')
  })

  it('throws when session not found', async () => {
    ;(prisma.session.findUnique as MockInstance).mockResolvedValue(null)
    await expect(getReplayData(MOCK_SESSION_CODE)).rejects.toThrow('Session not found')
  })

  it('throws when session not ended', async () => {
    ;(prisma.session.findUnique as MockInstance).mockResolvedValue({
      ...await (prisma.session.findUnique as MockInstance).mock.results[0]?.value,
      id: MOCK_SESSION_ID,
      code: MOCK_SESSION_CODE,
      status: 'LIVE',
      host: { id: 'host-id', username: 'host', realname: 'Host User' },
      moderator: null,
    })
    await expect(getReplayData(MOCK_SESSION_CODE)).rejects.toThrow('Session has not ended')
  })

  it('returns structured replay data', async () => {
    const data = await getReplayData(MOCK_SESSION_CODE)

    expect(data.session.code).toBe(MOCK_SESSION_CODE)
    expect(data.session.name).toBe('Test Debate')
    expect(data.session.type).toBe('ONE_ON_ONE')

    // Turns should be normalized (exclude DEBATE_START placeholder from meaningful turns)
    expect(data.turns).toHaveLength(3) // all turn logs are included, just normalized

    // Transcripts
    expect(data.transcripts).toHaveLength(2)
    expect(data.transcripts[0].speakerName).toBe('Alice Smith')
    expect(data.transcripts[1].speakerName).toBe('Bob Jones')

    // Participants
    expect(data.participants).toHaveLength(3)

    // Analytics
    expect(data.analytics.participants).toHaveLength(2) // Alice and Bob (DEBATE_START excluded)
    expect(data.analytics.session.totalTurns).toBe(2) // excludes DEBATE_START
    expect(data.debateDuration).toBeGreaterThan(0)
  })

  it('returns empty turns and transcripts for debate with no data', async () => {
    ;(prisma.turnLog.findMany as MockInstance).mockResolvedValue([])
    ;(prisma.transcript.findMany as MockInstance).mockResolvedValue([])

    const data = await getReplayData(MOCK_SESSION_CODE)
    expect(data.turns).toEqual([])
    expect(data.transcripts).toEqual([])
    expect(data.analytics.participants).toEqual([])
    expect(data.debateDuration).toBe(0)
  })
})

// ── getSessionAnalytics ──

describe('getSessionAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    mockEndedSession()
    mockTurnLogs()
    mockTranscripts()
  })

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(getSessionAnalytics(MOCK_SESSION_CODE)).rejects.toThrow('Not authenticated')
  })

  it('computes correct analytics', async () => {
    const analytics = await getSessionAnalytics(MOCK_SESSION_CODE)

    expect(analytics.participants).toHaveLength(2)

    const alice = analytics.participants.find((p) => p.speakerName === 'Alice')!
    expect(alice.totalSpeakingTime).toBe(120)
    expect(alice.turnCount).toBe(1)
    expect(alice.wordsSpoken).toBe(5) // "Hello world this is Alice"

    const bob = analytics.participants.find((p) => p.speakerName === 'Bob')!
    expect(bob.totalSpeakingTime).toBe(120)
    expect(bob.wordsSpoken).toBe(4) // "And this is Bob"

    expect(analytics.session.totalTurns).toBe(2)
    expect(analytics.session.totalWords).toBe(9)
  })
})

// ── exportAnalyticsCsv ──

describe('exportAnalyticsCsv', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    mockEndedSession()
    mockTurnLogs()
    mockTranscripts()
  })

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(exportAnalyticsCsv(MOCK_SESSION_CODE)).rejects.toThrow('Not authenticated')
  })

  it('returns valid CSV string', async () => {
    const csv = await exportAnalyticsCsv(MOCK_SESSION_CODE)

    expect(csv).toContain('participant_name')
    expect(csv).toContain('Alice')
    expect(csv).toContain('Bob')
    expect(csv).toContain('SESSION TOTAL')

    // Verify it's parseable CSV
    const lines = csv.trim().split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(3) // header + 2 participants + session total
  })
})
