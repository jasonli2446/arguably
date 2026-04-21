'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Socket as IoSocket } from 'socket.io-client'

interface DebateParticipant {
  userId: string
  displayName: string
}

type DebateStatus = 'idle' | 'live' | 'paused' | 'ended'
type DebatePhase = 'ACTIVE' | 'GRACE' | 'PAUSED' | 'ENDED'

interface UseDebateChannelOptions {
  sfuUrl: string | undefined
  roomCode: string
  userId: string | null
  onParticipantKicked?: (userId: string) => void
  onParticipantPromoted?: (userId: string) => void
  onParticipantMuted?: (userId: string) => void
}

interface SocketResponse {
  success: boolean
  error?: string
  state?: FullDebateState
}

interface FullDebateState {
  debaterOrder: DebateParticipant[]
  currentIndex: number
  turnStartedAt: number | null
  turnLength: number
  isPaused: boolean
  phase: DebatePhase
  version: number
  pausedTimeRemaining?: number
}

interface TurnChangedPayload {
  debaterOrder: DebateParticipant[]
  currentIndex: number
  turnStartedAt: number
  turnLength: number
  phase?: DebatePhase
  version: number
}

interface TurnExpiringPayload { version: number }
interface TurnWarningPayload { secondsRemaining: number }
interface DebatePausedPayload { version: number; timeRemaining: number }
interface DebateResumedPayload { version: number; turnStartedAt: number; turnLength: number }

// Socket.io emit with ack helper
function request(socket: IoSocket, event: string, data: Record<string, unknown> = {}): Promise<SocketResponse> {
  return new Promise((resolve, reject) => {
    socket.emit(event, data, (response: SocketResponse) => {
      if (response.success) {
        resolve(response)
      } else {
        reject(new Error(response.error || 'Unknown error'))
      }
    })
  })
}

export function useDebateChannel({
  sfuUrl,
  roomCode,
  userId,
  onParticipantKicked,
  onParticipantPromoted,
  onParticipantMuted,
}: UseDebateChannelOptions) {
  const [debaters, setDebaters] = useState<DebateParticipant[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null)
  const [turnLength, setTurnLength] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [debateStatus, setDebateStatus] = useState<DebateStatus>('idle')
  const [timeRemaining, setTimeRemaining] = useState(0)
  const [phase, setPhase] = useState<DebatePhase>('ACTIVE')
  const [version, setVersion] = useState(0)
  const [graceCountdown, setGraceCountdown] = useState<number | null>(null)

  const socketRef = useRef<IoSocket | null>(null)
  const warnedRef = useRef<Set<number>>(new Set())
  const onKickedRef = useRef(onParticipantKicked)
  const onPromotedRef = useRef(onParticipantPromoted)
  const onMutedRef = useRef(onParticipantMuted)
  onKickedRef.current = onParticipantKicked
  onPromotedRef.current = onParticipantPromoted
  onMutedRef.current = onParticipantMuted

  const currentSpeaker = debaters[currentIndex] ?? null
  const isMyTurn = currentSpeaker?.userId === userId

  const playBeep = useCallback((freq: number) => {
    try {
      const ctx = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.3)
    } catch { /* audio not supported */ }
  }, [])

  // Connect to SFU and subscribe to debate events
  useEffect(() => {
    if (!sfuUrl || !roomCode) return

    let cancelled = false

    async function connect() {
      const { io } = await import('socket.io-client')

      if (cancelled) return

      const socket = io(sfuUrl!, {
        transports: ['websocket'],
        auth: { userId },
      })
      socketRef.current = socket

      socket.on('connect', async () => {
        if (cancelled) return

        try {
          // Join debate room (lightweight, no mediasoup)
          await request(socket, 'joinDebateRoom', { roomCode })

          // Fetch initial state (handles refresh recovery)
          const resp = await request(socket, 'getDebateState', { roomCode })
          if (resp.state) {
            applyFullState(resp.state)
          }
        } catch (err) {
          console.error('Debate room join error:', err)
        }
      })

      // ── Debate events ──

      socket.on('turnChanged', (payload: TurnChangedPayload) => {
        setDebaters(payload.debaterOrder)
        setCurrentIndex(payload.currentIndex)
        setTurnStartedAt(payload.turnStartedAt)
        setTurnLength(payload.turnLength)
        setIsPaused(false)
        setDebateStatus('live')
        setPhase(payload.phase || 'ACTIVE')
        setVersion(payload.version)
        setGraceCountdown(null)
        warnedRef.current = new Set()
      })

      socket.on('turnExpiring', (payload: TurnExpiringPayload) => {
        setPhase('GRACE')
        setVersion(payload.version)
        setGraceCountdown(3)
      })

      socket.on('turnWarning', (payload: TurnWarningPayload) => {
        const secs = payload.secondsRemaining
        if (secs === 30) playBeep(440)
        if (secs === 10) playBeep(880)
      })

      socket.on('debatePaused', (payload: DebatePausedPayload) => {
        setIsPaused(true)
        setDebateStatus('paused')
        setPhase('PAUSED')
        setVersion(payload.version)
        setTimeRemaining(Math.ceil(payload.timeRemaining))
        setTurnStartedAt(null)
      })

      socket.on('debateResumed', (payload: DebateResumedPayload) => {
        setIsPaused(false)
        setDebateStatus('live')
        setPhase('ACTIVE')
        setVersion(payload.version)
        setTurnStartedAt(payload.turnStartedAt)
        setTurnLength(payload.turnLength)
        warnedRef.current = new Set()
      })

      socket.on('debateEnded', () => {
        setDebateStatus('ended')
        setDebaters([])
        setTurnStartedAt(null)
        setTimeRemaining(0)
        setPhase('ENDED')
        setGraceCountdown(null)
      })

      socket.on('participantKicked', (payload: { userId: string }) => {
        onKickedRef.current?.(payload.userId)
      })

      socket.on('participantPromoted', (payload: { userId: string }) => {
        onPromotedRef.current?.(payload.userId)
      })

      socket.on('participantMuted', (payload: { userId: string }) => {
        onMutedRef.current?.(payload.userId)
      })

      socket.on('disconnect', () => {
        if (!cancelled) {
          console.log('Debate socket disconnected')
        }
      })
    }

    function applyFullState(state: FullDebateState) {
      setDebaters(state.debaterOrder)
      setCurrentIndex(state.currentIndex)
      setTurnStartedAt(state.turnStartedAt)
      setTurnLength(state.turnLength)
      setIsPaused(state.isPaused)
      setPhase(state.phase)
      setVersion(state.version)
      warnedRef.current = new Set()

      if (state.phase === 'ENDED') {
        setDebateStatus('ended')
      } else if (state.isPaused) {
        setDebateStatus('paused')
        setTimeRemaining(Math.ceil(state.pausedTimeRemaining ?? 0))
      } else if (state.debaterOrder.length > 0) {
        setDebateStatus('live')
      }
    }

    connect()

    return () => {
      cancelled = true
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }
    }
  }, [sfuUrl, roomCode, userId, playBeep])

  // Timer countdown (client-side, derived from turnStartedAt + turnLength)
  useEffect(() => {
    if (debateStatus !== 'live' || isPaused || turnStartedAt === null) return

    const tick = () => {
      const elapsed = (Date.now() - turnStartedAt) / 1000
      const remaining = Math.max(0, Math.ceil(turnLength - elapsed))
      setTimeRemaining(remaining)
    }

    tick()
    const interval = setInterval(tick, 250)
    return () => clearInterval(interval)
  }, [debateStatus, isPaused, turnStartedAt, turnLength])

  // Grace period countdown
  useEffect(() => {
    if (graceCountdown === null || graceCountdown <= 0) return

    const timer = setTimeout(() => {
      setGraceCountdown((prev) => (prev !== null && prev > 0 ? prev - 1 : null))
    }, 1000)

    return () => clearTimeout(timer)
  }, [graceCountdown])

  // Actions (emit via Socket.io)
  const startDebate = useCallback(
    async (debaterList: DebateParticipant[], turnLen: number, format: string) => {
      if (!socketRef.current) throw new Error('Not connected')
      await request(socketRef.current, 'startDebate', {
        roomCode,
        debaters: debaterList,
        turnLength: turnLen,
        format,
      })
    },
    [roomCode],
  )

  const nextTurn = useCallback(async () => {
    if (!socketRef.current) throw new Error('Not connected')
    await request(socketRef.current, 'nextTurn', { roomCode, version })
  }, [roomCode, version])

  const pause = useCallback(async () => {
    if (!socketRef.current) throw new Error('Not connected')
    await request(socketRef.current, 'pauseDebate', { roomCode })
  }, [roomCode])

  const resume = useCallback(async () => {
    if (!socketRef.current) throw new Error('Not connected')
    await request(socketRef.current, 'resumeDebate', { roomCode })
  }, [roomCode])

  const endDebate = useCallback(async () => {
    if (!socketRef.current) throw new Error('Not connected')
    await request(socketRef.current, 'endDebate', { roomCode })
  }, [roomCode])

  const broadcastKick = useCallback(async (userId: string) => {
    if (!socketRef.current) return
    await request(socketRef.current, 'moderatorKick', { roomCode, userId })
  }, [roomCode])

  const broadcastPromote = useCallback(async (userId: string) => {
    if (!socketRef.current) return
    await request(socketRef.current, 'moderatorPromote', { roomCode, userId })
  }, [roomCode])

  const broadcastMute = useCallback(async (targetUserId: string) => {
    if (!socketRef.current) return
    await request(socketRef.current, 'moderatorMute', { roomCode, targetUserId })
  }, [roomCode])

  return {
    currentSpeaker,
    timeRemaining,
    isPaused,
    isMyTurn,
    debateStatus,
    debaters,
    phase,
    version,
    graceCountdown,
    startDebate,
    nextTurn,
    pause,
    resume,
    endDebate,
    broadcastKick,
    broadcastPromote,
    broadcastMute,
  }
}
