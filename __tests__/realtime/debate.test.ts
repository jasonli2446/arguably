import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../realtime/src/db', () => ({
  persistDebateState: vi.fn().mockResolvedValue(undefined),
  loadDebateState: vi.fn().mockResolvedValue(null),
  loadAllActiveDebates: vi.fn().mockResolvedValue([]),
  logTurnTransition: vi.fn().mockResolvedValue(undefined),
  getSessionByCode: vi.fn().mockResolvedValue(null),
  getSessionCodeById: vi.fn().mockResolvedValue(null),
  validateDebaterIds: vi.fn().mockResolvedValue(true),
  isHostOrModerator: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../realtime/src/mediasoup/rooms', () => ({
  getRoom: vi.fn().mockReturnValue(undefined),
}))

import {
  startDebate,
  advanceTurn,
  pauseDebate,
  resumeDebate,
  endDebate,
  getState,
  handleSpeakerDisconnect,
  checkAuthorization,
  recoverDebates,
  getOrLoadState,
} from '../../realtime/src/debate'
import * as db from '../../realtime/src/db'

const ROOM = 'ARG-TEST'

function mockIo() {
  const emitFn = vi.fn()
  return {
    to: vi.fn().mockReturnValue({ emit: emitFn }),
    _emit: emitFn,
  } as any
}

function mockSession(type = 'ONE_ON_ONE') {
  vi.mocked(db.getSessionByCode).mockResolvedValue({
    id: 'sess-1', code: ROOM, type, host_id: 'host', moderator_id: null,
  } as any)
}

const d2 = [
  { userId: 'u1', displayName: 'Alice' },
  { userId: 'u2', displayName: 'Bob' },
]
const d4 = [
  { userId: 'u1', displayName: 'Alice' },
  { userId: 'u2', displayName: 'Bob' },
  { userId: 'u3', displayName: 'Charlie' },
  { userId: 'u4', displayName: 'Diana' },
]

async function setupDebate(io: any, opts?: { room?: string; debaters?: any[]; turnLength?: number; format?: any }) {
  const room = opts?.room ?? ROOM
  const debaters = opts?.debaters ?? d2
  const turnLength = opts?.turnLength ?? 60
  const format = opts?.format ?? 'ONE_ON_ONE'
  mockSession(format)
  return startDebate(room, debaters, turnLength, format, null, io)
}

describe('debate engine', () => {
  let io: any

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    io = mockIo()
    // Re-establish default mock returns after clearAllMocks
    vi.mocked(db.persistDebateState).mockResolvedValue(undefined)
    vi.mocked(db.logTurnTransition).mockResolvedValue(undefined)
    vi.mocked(db.validateDebaterIds).mockResolvedValue(true)
    vi.mocked(db.isHostOrModerator).mockResolvedValue(true)
    vi.mocked(db.loadAllActiveDebates).mockResolvedValue([])
    vi.mocked(db.loadDebateState).mockResolvedValue(null)
    vi.mocked(db.getSessionByCode).mockResolvedValue(null)
    vi.mocked(db.getSessionCodeById).mockResolvedValue(null)
  })

  afterEach(async () => {
    // Clean up any lingering debates
    if (getState(ROOM)) await endDebate(ROOM, io)
    if (getState('room2')) await endDebate('room2', io)
    vi.useRealTimers()
  })

  // ═══════════════════════════════════
  // startDebate validation
  // ═══════════════════════════════════

  describe('startDebate', () => {
    it('rejects turnLength < 1', async () => {
      const r = await startDebate(ROOM, d2, 0, 'ONE_ON_ONE', null, io)
      expect(r).toEqual({ success: false, error: 'Turn length must be 1-1800 seconds' })
    })

    it('rejects turnLength > 1800', async () => {
      const r = await startDebate(ROOM, d2, 1801, 'ONE_ON_ONE', null, io)
      expect(r).toEqual({ success: false, error: 'Turn length must be 1-1800 seconds' })
    })

    it('accepts turnLength at boundaries', async () => {
      mockSession()
      const r1 = await startDebate(ROOM, d2, 1, 'ONE_ON_ONE', null, io)
      expect(r1.success).toBe(true)
      await endDebate(ROOM, io)

      const r2 = await startDebate(ROOM, d2, 1800, 'ONE_ON_ONE', null, io)
      expect(r2.success).toBe(true)
    })

    it('rejects < 2 debaters', async () => {
      const r = await startDebate(ROOM, [d2[0]], 60, 'ONE_ON_ONE', null, io)
      expect(r.success).toBe(false)
      expect(r.error).toContain('At least 2')
    })

    it('rejects ONE_ON_ONE with 3 debaters', async () => {
      const r = await startDebate(ROOM, d4.slice(0, 3), 60, 'ONE_ON_ONE', null, io)
      expect(r.success).toBe(false)
      expect(r.error).toContain('exactly 2')
    })

    it('rejects PANEL with 2 debaters', async () => {
      mockSession('PANEL')
      const r = await startDebate(ROOM, d2, 60, 'PANEL', null, io)
      expect(r.success).toBe(false)
      expect(r.error).toContain('3-6')
    })

    it('rejects PANEL with 7 debaters', async () => {
      mockSession('PANEL')
      const d7 = [...d4, { userId: 'u5', displayName: 'E' }, { userId: 'u6', displayName: 'F' }, { userId: 'u7', displayName: 'G' }]
      const r = await startDebate(ROOM, d7, 60, 'PANEL', null, io)
      expect(r.success).toBe(false)
    })

    it('rejects if session not found', async () => {
      vi.mocked(db.getSessionByCode).mockResolvedValue(null)
      const r = await startDebate(ROOM, d2, 60, 'ONE_ON_ONE', null, io)
      expect(r).toEqual({ success: false, error: 'Session not found' })
    })

    it('rejects if debater IDs invalid', async () => {
      mockSession()
      vi.mocked(db.validateDebaterIds).mockResolvedValue(false)
      const r = await startDebate(ROOM, d2, 60, 'ONE_ON_ONE', null, io)
      expect(r).toEqual({ success: false, error: 'Invalid debater IDs' })
    })

    it('rejects if format mismatches session type', async () => {
      mockSession('PANEL')
      const r = await startDebate(ROOM, d2, 60, 'ONE_ON_ONE', null, io)
      expect(r.success).toBe(false)
      expect(r.error).toContain('Format does not match')
    })

    it('succeeds and sets initial state', async () => {
      const r = await setupDebate(io)
      expect(r.success).toBe(true)

      const s = getState(ROOM)!
      expect(s.currentIndex).toBe(0)
      expect(s.debaterOrder).toEqual(d2)
      expect(s.phase).toBe('ACTIVE')
      expect(s.version).toBe(0)
      expect(s.turnLength).toBe(60)
      expect(s.isPaused).toBe(false)
    })

    it('persists state to DB', async () => {
      await setupDebate(io)
      expect(db.persistDebateState).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'sess-1', phase: 'ACTIVE', version: 0 }),
      )
    })

    it('logs DEBATE_START transition', async () => {
      await setupDebate(io)
      expect(db.logTurnTransition).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'DEBATE_START', speakerUserId: 'u1', turnIndex: 0 }),
      )
    })

    it('emits turnChanged to room', async () => {
      await setupDebate(io)
      expect(io.to).toHaveBeenCalledWith(ROOM)
      expect(io._emit).toHaveBeenCalledWith('turnChanged', expect.objectContaining({
        currentIndex: 0, phase: 'ACTIVE', turnLength: 60,
      }))
    })
  })

  // ═══════════════════════════════════
  // advanceTurn
  // ═══════════════════════════════════

  describe('advanceTurn', () => {
    beforeEach(async () => {
      await setupDebate(io)
      vi.clearAllMocks()
    })

    it('returns error for nonexistent room', async () => {
      const r = await advanceTurn('nope', 'MANUAL_ADVANCE', io)
      expect(r).toEqual({ success: false, error: 'No active debate' })
    })

    it('debounces rapid calls', async () => {
      const r1 = await advanceTurn(ROOM, 'MANUAL_ADVANCE', io)
      expect(r1.success).toBe(true)

      const r2 = await advanceTurn(ROOM, 'MANUAL_ADVANCE', io)
      expect(r2).toEqual({ success: false, error: 'Too fast' })
    })

    it('allows advance after debounce window', async () => {
      await advanceTurn(ROOM, 'MANUAL_ADVANCE', io)
      vi.advanceTimersByTime(501)
      const r = await advanceTurn(ROOM, 'MANUAL_ADVANCE', io)
      expect(r.success).toBe(true)
    })

    it('rejects stale version', async () => {
      const r = await advanceTurn(ROOM, 'MANUAL_ADVANCE', io, 999)
      expect(r).toEqual({ success: false, error: 'Stale version' })
    })

    it('accepts matching version', async () => {
      const v = getState(ROOM)!.version
      const r = await advanceTurn(ROOM, 'MANUAL_ADVANCE', io, v)
      expect(r.success).toBe(true)
    })

    it('rejects when PAUSED', async () => {
      await pauseDebate(ROOM, io)
      const r = await advanceTurn(ROOM, 'MANUAL_ADVANCE', io)
      expect(r).toEqual({ success: false, error: 'Debate is not active' })
    })

    it('ONE_ON_ONE alternates 0 → 1 → 0', async () => {
      expect(getState(ROOM)!.currentIndex).toBe(0)

      await advanceTurn(ROOM, 'MANUAL_ADVANCE', io)
      expect(getState(ROOM)!.currentIndex).toBe(1)

      vi.advanceTimersByTime(501)
      await advanceTurn(ROOM, 'MANUAL_ADVANCE', io)
      expect(getState(ROOM)!.currentIndex).toBe(0)
    })

    it('PANEL: circular through 4 debaters', async () => {
      await endDebate(ROOM, io)
      mockSession('PANEL')
      await startDebate('room2', d4, 60, 'PANEL', null, io)

      for (let expected = 1; expected <= 4; expected++) {
        vi.advanceTimersByTime(501)
        await advanceTurn('room2', 'MANUAL_ADVANCE', io)
        expect(getState('room2')!.currentIndex).toBe(expected % 4)
      }
      await endDebate('room2', io)
    })

    it('EXPERT_VS_CROWD: expert(0) ↔ challenger(1)', async () => {
      await endDebate(ROOM, io)
      mockSession('EXPERT_VS_CROWD')
      await startDebate('room2', d2, 60, 'EXPERT_VS_CROWD', null, io)

      expect(getState('room2')!.currentIndex).toBe(0) // expert
      await advanceTurn('room2', 'MANUAL_ADVANCE', io)
      expect(getState('room2')!.currentIndex).toBe(1) // challenger
      vi.advanceTimersByTime(501)
      await advanceTurn('room2', 'MANUAL_ADVANCE', io)
      expect(getState('room2')!.currentIndex).toBe(0) // back to expert
      await endDebate('room2', io)
    })

    it('increments version', async () => {
      const before = getState(ROOM)!.version
      await advanceTurn(ROOM, 'MANUAL_ADVANCE', io)
      expect(getState(ROOM)!.version).toBe(before + 1)
    })

    it('logs turn transition', async () => {
      await advanceTurn(ROOM, 'MANUAL_ADVANCE', io)
      expect(db.logTurnTransition).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'MANUAL_ADVANCE', speakerUserId: 'u1', turnIndex: 0 }),
      )
    })

    it('emits forceMute for old speaker and forceUnmute for new', async () => {
      await advanceTurn(ROOM, 'MANUAL_ADVANCE', io)
      const calls = io._emit.mock.calls
      expect(calls).toContainEqual(['forceMute', { userId: 'u1' }])
      expect(calls).toContainEqual(['forceUnmute', { userId: 'u2' }])
    })

    it('emits turnChanged with correct payload', async () => {
      await advanceTurn(ROOM, 'MANUAL_ADVANCE', io)
      expect(io._emit).toHaveBeenCalledWith('turnChanged', expect.objectContaining({
        version: 1, currentIndex: 1, phase: 'ACTIVE', turnLength: 60,
      }))
    })
  })

  // ═══════════════════════════════════
  // pauseDebate / resumeDebate
  // ═══════════════════════════════════

  describe('pauseDebate', () => {
    beforeEach(async () => {
      await setupDebate(io)
      vi.advanceTimersByTime(10_000) // 10s elapsed
      vi.clearAllMocks()
    })

    it('returns error for nonexistent room', async () => {
      expect(await pauseDebate('nope', io)).toEqual({ success: false, error: 'No active debate' })
    })

    it('returns error if already paused', async () => {
      await pauseDebate(ROOM, io)
      expect(await pauseDebate(ROOM, io)).toEqual({ success: false, error: 'Not active' })
    })

    it('sets phase to PAUSED and calculates remaining time', async () => {
      await pauseDebate(ROOM, io)
      const s = getState(ROOM)!
      expect(s.phase).toBe('PAUSED')
      expect(s.isPaused).toBe(true)
      expect(s.pausedTimeRemaining).toBeGreaterThan(45)
      expect(s.pausedTimeRemaining).toBeLessThanOrEqual(50)
      expect(s.turnStartedAt).toBeNull()
    })

    it('increments version', async () => {
      const v = getState(ROOM)!.version
      await pauseDebate(ROOM, io)
      expect(getState(ROOM)!.version).toBe(v + 1)
    })

    it('emits debatePaused', async () => {
      await pauseDebate(ROOM, io)
      expect(io._emit).toHaveBeenCalledWith('debatePaused', expect.objectContaining({
        timeRemaining: expect.any(Number),
      }))
    })
  })

  describe('resumeDebate', () => {
    beforeEach(async () => {
      await setupDebate(io)
      vi.advanceTimersByTime(10_000)
      await pauseDebate(ROOM, io)
      vi.clearAllMocks()
    })

    it('returns error if not paused', async () => {
      await resumeDebate(ROOM, io) // unpause first
      expect(await resumeDebate(ROOM, io)).toEqual({ success: false, error: 'Not paused' })
    })

    it('sets phase to ACTIVE', async () => {
      await resumeDebate(ROOM, io)
      const s = getState(ROOM)!
      expect(s.phase).toBe('ACTIVE')
      expect(s.isPaused).toBe(false)
      expect(s.turnStartedAt).not.toBeNull()
    })

    it('emits debateResumed', async () => {
      await resumeDebate(ROOM, io)
      expect(io._emit).toHaveBeenCalledWith('debateResumed', expect.objectContaining({
        turnStartedAt: expect.any(Number), turnLength: expect.any(Number),
      }))
    })

    it('schedules timer for remaining time and fires grace', async () => {
      const remaining = getState(ROOM)!.pausedTimeRemaining
      await resumeDebate(ROOM, io)
      vi.clearAllMocks()

      // Just before expiry — still ACTIVE
      vi.advanceTimersByTime(remaining * 1000 - 100)
      expect(getState(ROOM)!.phase).toBe('ACTIVE')

      // After expiry — GRACE
      vi.advanceTimersByTime(200)
      expect(getState(ROOM)!.phase).toBe('GRACE')
    })
  })

  // ═══════════════════════════════════
  // endDebate
  // ═══════════════════════════════════

  describe('endDebate', () => {
    beforeEach(async () => {
      await setupDebate(io)
      vi.clearAllMocks()
    })

    it('removes debate from memory', async () => {
      await endDebate(ROOM, io)
      expect(getState(ROOM)).toBeNull()
    })

    it('logs final turn', async () => {
      await endDebate(ROOM, io)
      expect(db.logTurnTransition).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'MANUAL_ADVANCE', speakerUserId: 'u1' }),
      )
    })

    it('emits debateEnded', async () => {
      await endDebate(ROOM, io)
      expect(io._emit).toHaveBeenCalledWith('debateEnded', expect.objectContaining({ version: expect.any(Number) }))
    })

    it('returns error for nonexistent room', async () => {
      expect(await endDebate('nope', io)).toEqual({ success: false, error: 'No active debate' })
    })
  })

  // ═══════════════════════════════════
  // Grace period & warning timers
  // ═══════════════════════════════════

  describe('grace period', () => {
    beforeEach(async () => {
      await setupDebate(io, { turnLength: 5 })
      vi.clearAllMocks()
    })

    it('enters GRACE phase when turn timer fires', () => {
      vi.advanceTimersByTime(5000)
      expect(getState(ROOM)!.phase).toBe('GRACE')
    })

    it('emits turnExpiring with expired userId', () => {
      vi.advanceTimersByTime(5000)
      expect(io._emit).toHaveBeenCalledWith('turnExpiring', expect.objectContaining({
        expiredUserId: 'u1',
      }))
    })

    it('emits forceMute for expired speaker', () => {
      vi.advanceTimersByTime(5000)
      expect(io._emit).toHaveBeenCalledWith('forceMute', { userId: 'u1' })
    })

    it('auto-advances after 3s grace', async () => {
      vi.advanceTimersByTime(5000) // turn expired → GRACE
      vi.clearAllMocks()

      await vi.advanceTimersByTimeAsync(3000) // grace period → auto-advance
      expect(getState(ROOM)!.currentIndex).toBe(1)
      expect(getState(ROOM)!.phase).toBe('ACTIVE')
      expect(io._emit).toHaveBeenCalledWith('turnChanged', expect.objectContaining({ currentIndex: 1 }))
    })
  })

  describe('warning timers', () => {
    it('60s turn emits warnings at 30s and 10s remaining', async () => {
      await setupDebate(io, { turnLength: 60 })
      vi.clearAllMocks()

      vi.advanceTimersByTime(30_000) // 30s elapsed → 30s remaining
      expect(io._emit).toHaveBeenCalledWith('turnWarning', { secondsRemaining: 30 })

      vi.clearAllMocks()
      vi.advanceTimersByTime(20_000) // 50s elapsed → 10s remaining
      expect(io._emit).toHaveBeenCalledWith('turnWarning', { secondsRemaining: 10 })
    })

    it('5s turn emits no warnings', async () => {
      await setupDebate(io, { turnLength: 5 })
      vi.clearAllMocks()

      vi.advanceTimersByTime(5000)
      const warnings = io._emit.mock.calls.filter((c: any) => c[0] === 'turnWarning')
      expect(warnings).toHaveLength(0)
    })

    it('15s turn emits only 10s warning', async () => {
      await setupDebate(io, { turnLength: 15 })
      vi.clearAllMocks()

      vi.advanceTimersByTime(5000) // 10s remaining
      expect(io._emit).toHaveBeenCalledWith('turnWarning', { secondsRemaining: 10 })

      const warnings = io._emit.mock.calls.filter((c: any) => c[0] === 'turnWarning')
      expect(warnings).toHaveLength(1) // only the 10s warning
    })
  })

  // ═══════════════════════════════════
  // handleSpeakerDisconnect
  // ═══════════════════════════════════

  describe('handleSpeakerDisconnect', () => {
    beforeEach(async () => {
      await setupDebate(io)
      vi.clearAllMocks()
    })

    it('auto-advances if current speaker disconnects', async () => {
      await handleSpeakerDisconnect(ROOM, 'u1', io)
      expect(getState(ROOM)!.currentIndex).toBe(1)
    })

    it('does nothing if non-current speaker disconnects', async () => {
      await handleSpeakerDisconnect(ROOM, 'u2', io)
      expect(getState(ROOM)!.currentIndex).toBe(0)
      expect(io._emit).not.toHaveBeenCalled()
    })

    it('does nothing if PAUSED', async () => {
      await pauseDebate(ROOM, io)
      vi.clearAllMocks()
      await handleSpeakerDisconnect(ROOM, 'u1', io)
      expect(io._emit).not.toHaveBeenCalled()
    })

    it('does nothing for nonexistent room', async () => {
      await handleSpeakerDisconnect('nope', 'u1', io)
      expect(io._emit).not.toHaveBeenCalled()
    })
  })

  // ═══════════════════════════════════
  // checkAuthorization
  // ═══════════════════════════════════

  describe('checkAuthorization', () => {
    it('uses cached sessionId when debate is in memory', async () => {
      await setupDebate(io)
      vi.clearAllMocks()

      await checkAuthorization(ROOM, 'host')
      expect(db.isHostOrModerator).toHaveBeenCalledWith('sess-1', 'host')
      // Should NOT call getSessionByCode since sessionId is cached
      expect(db.getSessionByCode).not.toHaveBeenCalled()
    })

    it('falls back to DB lookup for unknown room', async () => {
      mockSession()
      await checkAuthorization('unknown-room', 'host')
      expect(db.getSessionByCode).toHaveBeenCalledWith('unknown-room')
    })

    it('returns false if session not found', async () => {
      vi.mocked(db.getSessionByCode).mockResolvedValue(null)
      const r = await checkAuthorization('unknown', 'host')
      expect(r).toBe(false)
    })
  })

  // ═══════════════════════════════════
  // Recovery
  // ═══════════════════════════════════

  describe('recoverDebates', () => {
    const makeRow = (overrides: Partial<db.DbDebateState> = {}): db.DbDebateState => ({
      id: 'ds-1',
      session_id: 'sess-1',
      debater_order: d2,
      current_index: 0,
      turn_length: 60,
      turn_ends_at: Date.now() + 30_000,
      is_paused: false,
      paused_time_remaining: 30,
      format: 'ONE_ON_ONE',
      format_meta: null,
      phase: 'ACTIVE',
      version: 5,
      ...overrides,
    })

    beforeEach(() => {
      vi.mocked(db.getSessionCodeById).mockResolvedValue(ROOM)
    })

    it('recovers PAUSED debate without timers', async () => {
      vi.mocked(db.loadAllActiveDebates).mockResolvedValue([
        makeRow({ phase: 'PAUSED', is_paused: true, turn_ends_at: null }),
      ])
      await recoverDebates(io)
      const s = getState(ROOM)!
      expect(s.phase).toBe('PAUSED')
      expect(s.isPaused).toBe(true)
    })

    it('recovers ACTIVE with remaining time → schedules timer', async () => {
      const futureEnd = Date.now() + 20_000
      vi.mocked(db.loadAllActiveDebates).mockResolvedValue([
        makeRow({ turn_ends_at: futureEnd }),
      ])
      await recoverDebates(io)
      expect(getState(ROOM)!.phase).toBe('ACTIVE')

      // Timer should fire roughly when the turn was supposed to end
      vi.advanceTimersByTime(20_100)
      expect(getState(ROOM)!.phase).toBe('GRACE')
    })

    it('recovers ACTIVE with expired time → immediately advances', async () => {
      vi.mocked(db.loadAllActiveDebates).mockResolvedValue([
        makeRow({ turn_ends_at: Date.now() - 5000 }),
      ])
      await recoverDebates(io)
      // Should have auto-advanced
      expect(getState(ROOM)!.currentIndex).toBe(1)
    })

    it('recovers GRACE → immediately advances', async () => {
      vi.mocked(db.loadAllActiveDebates).mockResolvedValue([
        makeRow({ phase: 'GRACE', turn_ends_at: Date.now() - 1000 }),
      ])
      await recoverDebates(io)
      expect(getState(ROOM)!.currentIndex).toBe(1)
    })

    it('skips if session code not found', async () => {
      vi.mocked(db.getSessionCodeById).mockResolvedValue(null)
      vi.mocked(db.loadAllActiveDebates).mockResolvedValue([makeRow()])
      await recoverDebates(io)
      expect(getState(ROOM)).toBeNull()
    })
  })

  describe('getOrLoadState', () => {
    it('returns in-memory state first', async () => {
      await setupDebate(io)
      vi.clearAllMocks()
      const s = await getOrLoadState(ROOM, io)
      expect(s).not.toBeNull()
      expect(s!.currentIndex).toBe(0)
      expect(db.loadDebateState).not.toHaveBeenCalled()
    })

    it('falls back to DB when not in memory', async () => {
      mockSession()
      vi.mocked(db.getSessionCodeById).mockResolvedValue(ROOM)
      vi.mocked(db.loadDebateState).mockResolvedValue({
        id: 'ds-2', session_id: 'sess-1', debater_order: d2, current_index: 1,
        turn_length: 60, turn_ends_at: Date.now() + 30_000, is_paused: false,
        paused_time_remaining: 30, format: 'ONE_ON_ONE', format_meta: null,
        phase: 'ACTIVE', version: 3,
      })
      const s = await getOrLoadState(ROOM, io)
      expect(s).not.toBeNull()
      expect(db.loadDebateState).toHaveBeenCalled()
    })

    it('returns null if session not found', async () => {
      vi.mocked(db.getSessionByCode).mockResolvedValue(null)
      const s = await getOrLoadState('nope', io)
      expect(s).toBeNull()
    })

    it('returns null if DB row phase is ENDED', async () => {
      mockSession()
      vi.mocked(db.loadDebateState).mockResolvedValue({
        id: 'ds-2', session_id: 'sess-1', debater_order: d2, current_index: 0,
        turn_length: 60, turn_ends_at: null, is_paused: false,
        paused_time_remaining: 0, format: 'ONE_ON_ONE', format_meta: null,
        phase: 'ENDED', version: 5,
      })
      const s = await getOrLoadState(ROOM, io)
      expect(s).toBeNull()
    })
  })

  // ═══════════════════════════════════
  // Full lifecycle integration
  // ═══════════════════════════════════

  describe('full lifecycle', () => {
    it('start → advance → pause → resume → end', async () => {
      await setupDebate(io)
      expect(getState(ROOM)!.phase).toBe('ACTIVE')
      expect(getState(ROOM)!.currentIndex).toBe(0)

      // Advance
      await advanceTurn(ROOM, 'MANUAL_ADVANCE', io)
      expect(getState(ROOM)!.currentIndex).toBe(1)
      expect(getState(ROOM)!.version).toBe(1)

      // Pause
      vi.advanceTimersByTime(501)
      await pauseDebate(ROOM, io)
      expect(getState(ROOM)!.phase).toBe('PAUSED')

      // Resume
      await resumeDebate(ROOM, io)
      expect(getState(ROOM)!.phase).toBe('ACTIVE')

      // End
      await endDebate(ROOM, io)
      expect(getState(ROOM)).toBeNull()
    })

    it('auto-advance full cycle: turn expires → grace → next turn', async () => {
      await setupDebate(io, { turnLength: 2 })
      expect(getState(ROOM)!.currentIndex).toBe(0)

      // Turn expires
      vi.advanceTimersByTime(2000)
      expect(getState(ROOM)!.phase).toBe('GRACE')

      // Grace period ends, auto-advance
      await vi.advanceTimersByTimeAsync(3000)
      expect(getState(ROOM)!.currentIndex).toBe(1)
      expect(getState(ROOM)!.phase).toBe('ACTIVE')
    })
  })
})
