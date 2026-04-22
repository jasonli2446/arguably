import { describe, it, expect } from 'vitest'
import {
  computeParticipantStats,
  computeSessionStats,
  normalizeTurnLogs,
  formatAnalyticsCsv,
  type TurnLogEntry,
  type TranscriptEntry,
} from '@/lib/analytics'

// ── Helpers ──

function makeDate(offsetMs: number): Date {
  return new Date(1700000000000 + offsetMs)
}

function makeTurnLog(overrides: Partial<TurnLogEntry> & { speaker_user_id: string | null }): TurnLogEntry {
  return {
    id: `tl-${Math.random().toString(36).slice(2, 8)}`,
    speaker_name: 'Speaker',
    turn_index: 0,
    reason: 'MANUAL_ADVANCE',
    started_at: makeDate(0),
    ended_at: makeDate(60000),
    duration_sec: 60,
    ...overrides,
  }
}

function makeTranscript(overrides: Partial<TranscriptEntry>): TranscriptEntry {
  return {
    id: `tr-${Math.random().toString(36).slice(2, 8)}`,
    speaker_id: 'u1',
    content: 'hello world',
    timestamp: 0,
    duration: null,
    ...overrides,
  }
}

// ── computeSessionStats ──

describe('computeSessionStats', () => {
  it('returns zeros for empty turn logs', () => {
    const stats = computeSessionStats([])
    expect(stats.debateDuration).toBe(0)
    expect(stats.totalTurns).toBe(0)
    expect(stats.debateStartTime).toBeNull()
    expect(stats.debateEndTime).toBeNull()
  })

  it('computes duration from first started_at to last ended_at', () => {
    const logs: TurnLogEntry[] = [
      makeTurnLog({
        speaker_user_id: 'u1',
        started_at: makeDate(0),
        ended_at: makeDate(60000),
        duration_sec: 60,
      }),
      makeTurnLog({
        speaker_user_id: 'u2',
        started_at: makeDate(60000),
        ended_at: makeDate(180000),
        duration_sec: 120,
      }),
    ]
    const stats = computeSessionStats(logs)
    expect(stats.debateDuration).toBe(180) // 180 seconds = 3 minutes
    expect(stats.totalTurns).toBe(2)
  })

  it('excludes DEBATE_START placeholder from turn count', () => {
    const logs: TurnLogEntry[] = [
      makeTurnLog({
        speaker_user_id: 'u1',
        reason: 'DEBATE_START',
        started_at: makeDate(0),
        ended_at: makeDate(0),
        duration_sec: 0,
      }),
      makeTurnLog({
        speaker_user_id: 'u1',
        started_at: makeDate(0),
        ended_at: makeDate(60000),
        duration_sec: 60,
      }),
    ]
    const stats = computeSessionStats(logs)
    expect(stats.totalTurns).toBe(1) // only the real turn
  })
})

// ── computeParticipantStats ──

describe('computeParticipantStats', () => {
  it('returns empty array for empty turn logs', () => {
    const stats = computeParticipantStats([], [], 120)
    expect(stats).toEqual([])
  })

  it('computes stats for two speakers', () => {
    const logs: TurnLogEntry[] = [
      makeTurnLog({
        speaker_user_id: 'u1',
        speaker_name: 'Alice',
        started_at: makeDate(0),
        ended_at: makeDate(60000),
        duration_sec: 60,
      }),
      makeTurnLog({
        speaker_user_id: 'u2',
        speaker_name: 'Bob',
        started_at: makeDate(60000),
        ended_at: makeDate(120000),
        duration_sec: 60,
      }),
    ]

    const transcripts: TranscriptEntry[] = [
      makeTranscript({ speaker_id: 'u1', content: 'hello world foo' }),
      makeTranscript({ speaker_id: 'u2', content: 'bar baz' }),
    ]

    const stats = computeParticipantStats(logs, transcripts, 120)
    expect(stats).toHaveLength(2)

    // Both have equal speaking time, sorted desc by time (same, so order may vary)
    const alice = stats.find((s) => s.speakerName === 'Alice')!
    const bob = stats.find((s) => s.speakerName === 'Bob')!

    expect(alice.totalSpeakingTime).toBe(60)
    expect(alice.turnCount).toBe(1)
    expect(alice.avgTurnDuration).toBe(60)
    expect(alice.longestTurn).toBe(60)
    expect(alice.wordsSpoken).toBe(3)
    expect(alice.speakingTimePercent).toBe(50)

    expect(bob.totalSpeakingTime).toBe(60)
    expect(bob.wordsSpoken).toBe(2)
  })

  it('excludes DEBATE_START placeholders', () => {
    const logs: TurnLogEntry[] = [
      makeTurnLog({
        speaker_user_id: 'u1',
        speaker_name: 'Alice',
        reason: 'DEBATE_START',
        duration_sec: 0,
      }),
      makeTurnLog({
        speaker_user_id: 'u1',
        speaker_name: 'Alice',
        reason: 'MANUAL_ADVANCE',
        duration_sec: 45,
      }),
    ]

    const stats = computeParticipantStats(logs, [], 120)
    expect(stats).toHaveLength(1)
    expect(stats[0].turnCount).toBe(1)
    expect(stats[0].totalSpeakingTime).toBe(45)
  })

  it('skips null speaker_user_id entries', () => {
    const logs: TurnLogEntry[] = [
      makeTurnLog({
        speaker_user_id: null,
        speaker_name: 'Unknown',
        duration_sec: 30,
      }),
      makeTurnLog({
        speaker_user_id: 'u1',
        speaker_name: 'Alice',
        duration_sec: 60,
      }),
    ]

    const stats = computeParticipantStats(logs, [], 120)
    expect(stats).toHaveLength(1)
    expect(stats[0].speakerName).toBe('Alice')
  })

  it('handles missing transcripts gracefully (0 words)', () => {
    const logs: TurnLogEntry[] = [
      makeTurnLog({
        speaker_user_id: 'u1',
        speaker_name: 'Alice',
        duration_sec: 60,
      }),
    ]

    const stats = computeParticipantStats(logs, [], 120)
    expect(stats[0].wordsSpoken).toBe(0)
  })

  it('handles zero debate duration', () => {
    const logs: TurnLogEntry[] = [
      makeTurnLog({
        speaker_user_id: 'u1',
        speaker_name: 'Alice',
        duration_sec: 10,
      }),
    ]

    const stats = computeParticipantStats(logs, [], 0)
    expect(stats[0].speakingTimePercent).toBe(0) // avoids division by zero
  })

  it('computes multiple turns for same speaker', () => {
    const logs: TurnLogEntry[] = [
      makeTurnLog({ speaker_user_id: 'u1', speaker_name: 'Alice', duration_sec: 30 }),
      makeTurnLog({ speaker_user_id: 'u2', speaker_name: 'Bob', duration_sec: 60 }),
      makeTurnLog({ speaker_user_id: 'u1', speaker_name: 'Alice', duration_sec: 45 }),
    ]

    const stats = computeParticipantStats(logs, [], 135)
    const alice = stats.find((s) => s.speakerName === 'Alice')!
    expect(alice.totalSpeakingTime).toBe(75)
    expect(alice.turnCount).toBe(2)
    expect(alice.avgTurnDuration).toBe(37.5)
    expect(alice.longestTurn).toBe(45)
  })
})

// ── normalizeTurnLogs ──

describe('normalizeTurnLogs', () => {
  it('converts absolute timestamps to relative offsets', () => {
    const debateStart = makeDate(0)
    const logs: TurnLogEntry[] = [
      makeTurnLog({
        speaker_user_id: 'u1',
        speaker_name: 'Alice',
        started_at: makeDate(0),
        ended_at: makeDate(60000),
        duration_sec: 60,
      }),
      makeTurnLog({
        speaker_user_id: 'u2',
        speaker_name: 'Bob',
        started_at: makeDate(60000),
        ended_at: makeDate(120000),
        duration_sec: 60,
      }),
    ]

    const normalized = normalizeTurnLogs(logs, debateStart)
    expect(normalized).toHaveLength(2)
    expect(normalized[0].startOffset).toBe(0)
    expect(normalized[0].endOffset).toBe(60)
    expect(normalized[1].startOffset).toBe(60)
    expect(normalized[1].endOffset).toBe(120)
  })

  it('returns empty array for empty logs', () => {
    const normalized = normalizeTurnLogs([], makeDate(0))
    expect(normalized).toEqual([])
  })
})

// ── formatAnalyticsCsv ──

describe('formatAnalyticsCsv', () => {
  it('generates valid CSV with headers and data rows', () => {
    const participantStats = [
      {
        speakerId: 'u1',
        speakerName: 'Alice',
        totalSpeakingTime: 60,
        turnCount: 2,
        avgTurnDuration: 30,
        longestTurn: 45,
        wordsSpoken: 150,
        speakingTimePercent: 50,
      },
    ]
    const sessionStats = {
      debateDuration: 120,
      totalTurns: 4,
      totalWords: 300,
      debateStartTime: makeDate(0),
      debateEndTime: makeDate(120000),
    }

    const csv = formatAnalyticsCsv(participantStats, sessionStats)
    const lines = csv.trim().split('\n')

    expect(lines[0]).toBe(
      'participant_name,total_speaking_time_s,turn_count,avg_turn_duration_s,longest_turn_s,words_spoken,speaking_time_pct'
    )
    expect(lines[1]).toBe('Alice,60,2,30,45,150,50')
    expect(lines[2]).toContain('SESSION TOTAL')
    expect(lines[2]).toContain('120')
  })

  it('escapes CSV fields with commas', () => {
    const participantStats = [
      {
        speakerId: 'u1',
        speakerName: 'Smith, John',
        totalSpeakingTime: 60,
        turnCount: 1,
        avgTurnDuration: 60,
        longestTurn: 60,
        wordsSpoken: 100,
        speakingTimePercent: 100,
      },
    ]
    const sessionStats = {
      debateDuration: 60,
      totalTurns: 1,
      totalWords: 100,
      debateStartTime: makeDate(0),
      debateEndTime: makeDate(60000),
    }

    const csv = formatAnalyticsCsv(participantStats, sessionStats)
    expect(csv).toContain('"Smith, John"')
  })

  it('handles empty participant list', () => {
    const csv = formatAnalyticsCsv([], {
      debateDuration: 0,
      totalTurns: 0,
      totalWords: 0,
      debateStartTime: null,
      debateEndTime: null,
    })
    const lines = csv.trim().split('\n')
    expect(lines).toHaveLength(2) // header + session total
  })
})
