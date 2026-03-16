import { describe, it, expect } from 'vitest'
import { SessionType } from '@/lib/generated/prisma'
import {
  formatTime,
  generateRoomCode,
  getInitials,
  getSessionCapacity,
  getTotalDebaterCapacity,
} from '@/lib/utils'

// ── formatTime ──
describe('formatTime', () => {
  it('formats 0 seconds as 0:00', () => {
    expect(formatTime(0)).toBe('0:00')
  })

  it('formats seconds under a minute', () => {
    expect(formatTime(5)).toBe('0:05')
    expect(formatTime(59)).toBe('0:59')
  })

  it('formats exact minutes', () => {
    expect(formatTime(60)).toBe('1:00')
    expect(formatTime(120)).toBe('2:00')
  })

  it('formats minutes and seconds', () => {
    expect(formatTime(90)).toBe('1:30')
    expect(formatTime(125)).toBe('2:05')
  })
})

// ── generateRoomCode ──
describe('generateRoomCode', () => {
  it('matches ARG-XXXX pattern', () => {
    const code = generateRoomCode()
    expect(code).toMatch(/^ARG-\d{4}$/)
  })

  it('produces 4-digit numbers (1000-9999)', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRoomCode()
      const num = parseInt(code.split('-')[1], 10)
      expect(num).toBeGreaterThanOrEqual(1000)
      expect(num).toBeLessThanOrEqual(9999)
    }
  })
})

// ── getInitials ──
describe('getInitials', () => {
  it('returns first letter of single word', () => {
    expect(getInitials('Alice')).toBe('A')
  })

  it('returns two initials from two words', () => {
    expect(getInitials('Alice Bob')).toBe('AB')
  })

  it('caps at 2 initials for longer names', () => {
    expect(getInitials('Alice Bob Carol')).toBe('AB')
  })

  it('returns uppercase', () => {
    expect(getInitials('alice bob')).toBe('AB')
  })
})

// ── getSessionCapacity ──
describe('getSessionCapacity', () => {
  it('returns proponent + opponent + audience + 1 for ONE_ON_ONE', () => {
    expect(
      getSessionCapacity({
        sessionType: SessionType.ONE_ON_ONE,
        debaterCapacityProponent: 1,
        debaterCapacityOpponent: 1,
        debaterCapacityPanel: null,
        audienceCapacity: 10,
      })
    ).toBe(13) // 1+1+10+1
  })

  it('returns panel + audience + 1 for PANEL', () => {
    expect(
      getSessionCapacity({
        sessionType: SessionType.PANEL,
        debaterCapacityProponent: null,
        debaterCapacityOpponent: null,
        debaterCapacityPanel: 5,
        audienceCapacity: 20,
      })
    ).toBe(26) // 5+20+1
  })

  it('handles null debater capacities as 0', () => {
    expect(
      getSessionCapacity({
        sessionType: SessionType.ONE_ON_ONE,
        debaterCapacityProponent: null,
        debaterCapacityOpponent: null,
        debaterCapacityPanel: null,
        audienceCapacity: 10,
      })
    ).toBe(11) // 0+0+10+1
  })

  it('works for TEAM type', () => {
    expect(
      getSessionCapacity({
        sessionType: SessionType.TEAM,
        debaterCapacityProponent: 3,
        debaterCapacityOpponent: 3,
        debaterCapacityPanel: null,
        audienceCapacity: 50,
      })
    ).toBe(57) // 3+3+50+1
  })

  it('works for EXPERT_VS_CROWD type', () => {
    expect(
      getSessionCapacity({
        sessionType: SessionType.EXPERT_VS_CROWD,
        debaterCapacityProponent: 1,
        debaterCapacityOpponent: 5,
        debaterCapacityPanel: null,
        audienceCapacity: 100,
      })
    ).toBe(107) // 1+5+100+1
  })
})

// ── getTotalDebaterCapacity ──
describe('getTotalDebaterCapacity', () => {
  it('returns total debater capacity for ONE_ON_ONE', () => {
    expect(
      getTotalDebaterCapacity({
        sessionType: SessionType.ONE_ON_ONE,
        debaterCapacityProponent: 1,
        debaterCapacityOpponent: 1,
        debaterCapacityPanel: null,
        audienceCapacity: 10,
      })
    ).toBe(2) // 13 - 10 - 1
  })

  it('returns panel capacity for PANEL', () => {
    expect(
      getTotalDebaterCapacity({
        sessionType: SessionType.PANEL,
        debaterCapacityProponent: null,
        debaterCapacityOpponent: null,
        debaterCapacityPanel: 4,
        audienceCapacity: 10,
      })
    ).toBe(4) // 15 - 10 - 1
  })
})
