// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// ── Mock socket.io-client (dynamic import-compatible) ──

let connectHandler: (() => void) | null = null
const eventHandlers = new Map<string, ((...args: any[]) => void)[]>()

const mockSocket = {
  on: vi.fn((event: string, handler: any) => {
    if (event === 'connect') {
      connectHandler = handler
    } else {
      const handlers = eventHandlers.get(event) ?? []
      handlers.push(handler)
      eventHandlers.set(event, handlers)
    }
  }),
  emit: vi.fn((_event: string, _data: any, callback?: any) => {
    if (callback) {
      if (_event === 'joinDebateRoom') callback({ success: true })
      else if (_event === 'getDebateState') callback({ success: true, state: null })
      else callback({ success: true })
    }
  }),
  disconnect: vi.fn(),
  connected: true,
}

const mockIoFn = vi.fn(() => mockSocket)

vi.mock('socket.io-client', () => ({
  io: (...args: any[]) => mockIoFn(...args),
}))

function emitServerEvent(event: string, payload: any) {
  const handlers = eventHandlers.get(event) ?? []
  for (const h of handlers) {
    h(payload)
  }
}

import { useDebateChannel } from '@/hooks/useDebateChannel'

describe('useDebateChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    connectHandler = null
    eventHandlers.clear()
    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'connect') connectHandler = handler
      else {
        const handlers = eventHandlers.get(event) ?? []
        handlers.push(handler)
        eventHandlers.set(event, handlers)
      }
    })
    mockSocket.emit.mockImplementation((_event: string, _data: any, callback?: any) => {
      if (callback) {
        if (_event === 'joinDebateRoom') callback({ success: true })
        else if (_event === 'getDebateState') callback({ success: true, state: null })
        else callback({ success: true })
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const opts = {
    sfuUrl: 'http://localhost:3001',
    roomCode: 'ARG-TEST',
    userId: 'u1',
  }

  async function renderAndConnect(overrides = {}) {
    const hookResult = renderHook(() => useDebateChannel({ ...opts, ...overrides }))
    // Wait for the dynamic import and connect
    await waitFor(() => {
      expect(connectHandler).not.toBeNull()
    })
    // Fire the connect handler
    await act(async () => { connectHandler!() })
    return hookResult
  }

  // ═══════════════════════════
  // Initial state
  // ═══════════════════════════

  it('starts with idle status', () => {
    const { result } = renderHook(() => useDebateChannel(opts))
    expect(result.current.debateStatus).toBe('idle')
    expect(result.current.debaters).toEqual([])
    expect(result.current.timeRemaining).toBe(0)
    expect(result.current.isPaused).toBe(false)
    expect(result.current.isMyTurn).toBe(false)
    expect(result.current.currentSpeaker).toBeNull()
    expect(result.current.graceCountdown).toBeNull()
  })

  it('connects to SFU with userId in auth', async () => {
    await renderAndConnect()
    expect(mockIoFn).toHaveBeenCalledWith('http://localhost:3001', expect.objectContaining({
      auth: { userId: 'u1' },
    }))
  })

  it('joins debate room and requests state on connect', async () => {
    await renderAndConnect()
    expect(mockSocket.emit).toHaveBeenCalledWith('joinDebateRoom', { roomCode: 'ARG-TEST' }, expect.any(Function))
    expect(mockSocket.emit).toHaveBeenCalledWith('getDebateState', { roomCode: 'ARG-TEST' }, expect.any(Function))
  })

  // ═══════════════════════════
  // Events
  // ═══════════════════════════

  it('handles turnChanged event', async () => {
    const { result } = await renderAndConnect()

    act(() => {
      emitServerEvent('turnChanged', {
        version: 1, currentIndex: 0,
        debaterOrder: [{ userId: 'u1', displayName: 'Alice' }, { userId: 'u2', displayName: 'Bob' }],
        turnStartedAt: Date.now(), turnLength: 60, phase: 'ACTIVE',
      })
    })

    expect(result.current.debateStatus).toBe('live')
    expect(result.current.debaters).toHaveLength(2)
    expect(result.current.currentSpeaker?.userId).toBe('u1')
    expect(result.current.isMyTurn).toBe(true)
    expect(result.current.phase).toBe('ACTIVE')
    expect(result.current.version).toBe(1)
  })

  it('handles turnExpiring → sets grace countdown', async () => {
    const { result } = await renderAndConnect()

    act(() => {
      emitServerEvent('turnChanged', {
        version: 0, currentIndex: 0,
        debaterOrder: [{ userId: 'u1', displayName: 'Alice' }],
        turnStartedAt: Date.now(), turnLength: 5, phase: 'ACTIVE',
      })
    })

    act(() => {
      emitServerEvent('turnExpiring', { version: 1, expiredUserId: 'u1' })
    })

    expect(result.current.phase).toBe('GRACE')
    expect(result.current.graceCountdown).toBe(3)
  })

  it('handles debatePaused event', async () => {
    const { result } = await renderAndConnect()

    act(() => {
      emitServerEvent('turnChanged', {
        version: 0, currentIndex: 0,
        debaterOrder: [{ userId: 'u1', displayName: 'Alice' }],
        turnStartedAt: Date.now(), turnLength: 60, phase: 'ACTIVE',
      })
    })

    act(() => {
      emitServerEvent('debatePaused', { version: 1, timeRemaining: 45 })
    })

    expect(result.current.debateStatus).toBe('paused')
    expect(result.current.isPaused).toBe(true)
    expect(result.current.timeRemaining).toBe(45)
  })

  it('handles debateResumed event', async () => {
    const { result } = await renderAndConnect()

    act(() => {
      emitServerEvent('debateResumed', { version: 2, turnStartedAt: Date.now(), turnLength: 45 })
    })

    expect(result.current.debateStatus).toBe('live')
    expect(result.current.isPaused).toBe(false)
    expect(result.current.phase).toBe('ACTIVE')
  })

  it('handles debateEnded event', async () => {
    const { result } = await renderAndConnect()

    act(() => {
      emitServerEvent('turnChanged', {
        version: 0, currentIndex: 0,
        debaterOrder: [{ userId: 'u1', displayName: 'Alice' }],
        turnStartedAt: Date.now(), turnLength: 60, phase: 'ACTIVE',
      })
    })

    act(() => { emitServerEvent('debateEnded', { version: 3 }) })

    expect(result.current.debateStatus).toBe('ended')
    expect(result.current.debaters).toEqual([])
  })

  // ═══════════════════════════
  // isMyTurn
  // ═══════════════════════════

  it('isMyTurn true when current speaker matches', async () => {
    const { result } = await renderAndConnect()
    act(() => {
      emitServerEvent('turnChanged', {
        version: 0, currentIndex: 0,
        debaterOrder: [{ userId: 'u1', displayName: 'Alice' }, { userId: 'u2', displayName: 'Bob' }],
        turnStartedAt: Date.now(), turnLength: 60, phase: 'ACTIVE',
      })
    })
    expect(result.current.isMyTurn).toBe(true)
  })

  it('isMyTurn false when someone else is speaking', async () => {
    const { result } = await renderAndConnect()
    act(() => {
      emitServerEvent('turnChanged', {
        version: 0, currentIndex: 1,
        debaterOrder: [{ userId: 'u1', displayName: 'Alice' }, { userId: 'u2', displayName: 'Bob' }],
        turnStartedAt: Date.now(), turnLength: 60, phase: 'ACTIVE',
      })
    })
    expect(result.current.isMyTurn).toBe(false)
  })

  // ═══════════════════════════
  // Actions
  // ═══════════════════════════

  it('startDebate emits correct event', async () => {
    const { result } = await renderAndConnect()
    vi.clearAllMocks()

    const debaters = [{ userId: 'u1', displayName: 'Alice' }, { userId: 'u2', displayName: 'Bob' }]
    await act(async () => {
      await result.current.startDebate(debaters, 120, 'ONE_ON_ONE')
    })

    expect(mockSocket.emit).toHaveBeenCalledWith('startDebate', expect.objectContaining({
      roomCode: 'ARG-TEST', debaters, turnLength: 120, format: 'ONE_ON_ONE',
    }), expect.any(Function))
  })

  it('nextTurn emits with current version', async () => {
    const { result } = await renderAndConnect()
    act(() => {
      emitServerEvent('turnChanged', {
        version: 7, currentIndex: 0,
        debaterOrder: [{ userId: 'u1', displayName: 'Alice' }],
        turnStartedAt: Date.now(), turnLength: 60, phase: 'ACTIVE',
      })
    })
    vi.clearAllMocks()

    await act(async () => { await result.current.nextTurn() })
    expect(mockSocket.emit).toHaveBeenCalledWith('nextTurn', { roomCode: 'ARG-TEST', version: 7 }, expect.any(Function))
  })

  it('pause emits pauseDebate', async () => {
    const { result } = await renderAndConnect()
    vi.clearAllMocks()
    await act(async () => { await result.current.pause() })
    expect(mockSocket.emit).toHaveBeenCalledWith('pauseDebate', { roomCode: 'ARG-TEST' }, expect.any(Function))
  })

  it('resume emits resumeDebate', async () => {
    const { result } = await renderAndConnect()
    vi.clearAllMocks()
    await act(async () => { await result.current.resume() })
    expect(mockSocket.emit).toHaveBeenCalledWith('resumeDebate', { roomCode: 'ARG-TEST' }, expect.any(Function))
  })

  it('endDebate emits endDebate', async () => {
    const { result } = await renderAndConnect()
    vi.clearAllMocks()
    await act(async () => { await result.current.endDebate() })
    expect(mockSocket.emit).toHaveBeenCalledWith('endDebate', { roomCode: 'ARG-TEST' }, expect.any(Function))
  })

  // ═══════════════════════════
  // Cleanup
  // ═══════════════════════════

  it('disconnects on unmount', async () => {
    const { unmount } = await renderAndConnect()
    unmount()
    expect(mockSocket.disconnect).toHaveBeenCalled()
  })

  // ═══════════════════════════
  // Refresh recovery
  // ═══════════════════════════

  it('applies initial state from getDebateState', async () => {
    mockSocket.emit.mockImplementation((_event: string, _data: any, callback?: any) => {
      if (callback) {
        if (_event === 'joinDebateRoom') callback({ success: true })
        else if (_event === 'getDebateState') {
          callback({
            success: true,
            state: {
              version: 3,
              debaterOrder: [{ userId: 'u1', displayName: 'Alice' }, { userId: 'u2', displayName: 'Bob' }],
              currentIndex: 1, turnLength: 120, turnStartedAt: Date.now(),
              isPaused: false, pausedTimeRemaining: 0,
              format: 'ONE_ON_ONE', formatMeta: null, phase: 'ACTIVE',
            },
          })
        } else callback({ success: true })
      }
    })

    const { result } = await renderAndConnect()

    expect(result.current.debateStatus).toBe('live')
    expect(result.current.debaters).toHaveLength(2)
    expect(result.current.version).toBe(3)
    expect(result.current.isMyTurn).toBe(false) // currentIndex=1 is Bob
  })
})
