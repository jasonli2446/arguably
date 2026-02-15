'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface DebateParticipant {
  userId: string
  displayName: string
}

type DebateStatus = 'idle' | 'live' | 'paused' | 'ended'

interface UseDebateStateOptions {
  sfuUrl: string | undefined
  roomId: string
  userId: string | null
  enabled: boolean
}

interface UseDebateStateReturn {
  currentSpeaker: DebateParticipant | null
  timeRemaining: number
  isPaused: boolean
  isMyTurn: boolean
  debateStatus: DebateStatus
  debaters: DebateParticipant[]
  startDebate: (debaters: DebateParticipant[], turnLength: number) => Promise<void>
  nextTurn: () => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  endDebate: () => Promise<void>
  notifyParticipantChanged: () => void
  onParticipantChanged: (callback: () => void) => () => void
}

function request(socket: any, event: string, data: Record<string, any> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    socket.emit(event, data, (response: any) => {
      if (response.success) {
        resolve(response)
      } else {
        reject(new Error(response.error || 'Unknown error'))
      }
    })
  })
}

export function useDebateState({
  sfuUrl,
  roomId,
  userId,
  enabled,
}: UseDebateStateOptions): UseDebateStateReturn {
  const [currentSpeaker, setCurrentSpeaker] = useState<DebateParticipant | null>(null)
  const [debaters, setDebaters] = useState<DebateParticipant[]>([])
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null)
  const [turnLength, setTurnLength] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [frozenTimeRemaining, setFrozenTimeRemaining] = useState(0)
  const [debateStatus, setDebateStatus] = useState<DebateStatus>('idle')
  const [timeRemaining, setTimeRemaining] = useState(0)

  const socketRef = useRef<any>(null)

  // Display timer — computed from server-authoritative turnStartedAt
  useEffect(() => {
    if (debateStatus !== 'live' || isPaused || turnStartedAt === null) {
      return
    }

    const tick = () => {
      const elapsed = (Date.now() - turnStartedAt) / 1000
      const remaining = Math.max(0, Math.ceil(turnLength - elapsed))
      setTimeRemaining(remaining)
    }

    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [debateStatus, isPaused, turnStartedAt, turnLength])

  // When paused, show frozen time
  useEffect(() => {
    if (isPaused) {
      setTimeRemaining(Math.ceil(frozenTimeRemaining))
    }
  }, [isPaused, frozenTimeRemaining])

  // Socket connection
  useEffect(() => {
    if (!enabled || !sfuUrl || !roomId) return

    let cancelled = false

    async function connect() {
      const { io } = await import('socket.io-client')

      if (cancelled) return

      const socket = io(sfuUrl!, {
        transports: ['websocket'],
        // Use a different namespace or just reuse the same connection
      })
      socketRef.current = socket

      socket.on('connect', async () => {
        if (cancelled) return

        // Join the socket.io room so we receive broadcasts
        await request(socket, 'joinDebateRoom', { roomId })

        // Get current debate state on connect (handles reconnect/late-join)
        try {
          const resp = await request(socket, 'getDebateState', { roomId })
          if (resp.state) {
            const s = resp.state
            setDebaters(s.debaterOrder)
            setCurrentSpeaker(s.debaterOrder[s.currentIndex])

            if (s.isPaused) {
              setDebateStatus('paused')
              setIsPaused(true)
              setFrozenTimeRemaining(s.pausedTimeRemaining)
              setTurnLength(s.pausedTimeRemaining)
            } else {
              setDebateStatus('live')
              setIsPaused(false)
              setTurnStartedAt(s.turnStartedAt)
              setTurnLength(s.turnLength)
            }
          }
        } catch {
          // No active debate — that's fine
        }
      })

      socket.on('turnChanged', (data: any) => {
        setCurrentSpeaker(data.currentSpeaker)
        setTurnStartedAt(data.turnStartedAt)
        setTurnLength(data.turnLength)
        setIsPaused(false)
        setDebateStatus('live')
      })

      socket.on('debatePaused', (data: any) => {
        setIsPaused(true)
        setFrozenTimeRemaining(data.timeRemaining)
        setTurnStartedAt(null)
        setDebateStatus('paused')
      })

      socket.on('debateResumed', (data: any) => {
        setIsPaused(false)
        setTurnStartedAt(data.turnStartedAt)
        setTurnLength(data.turnLength)
        setDebateStatus('live')
      })

      socket.on('debateEnded', () => {
        setCurrentSpeaker(null)
        setDebaters([])
        setTurnStartedAt(null)
        setTurnLength(0)
        setIsPaused(false)
        setDebateStatus('ended')
        setTimeRemaining(0)
      })
    }

    connect()

    return () => {
      cancelled = true
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }
    }
  }, [enabled, sfuUrl, roomId])

  const startDebateAction = useCallback(
    async (debaterList: DebateParticipant[], turnLen: number) => {
      if (!socketRef.current) return
      setDebaters(debaterList)
      await request(socketRef.current, 'startDebate', {
        roomId,
        debaters: debaterList,
        turnLength: turnLen,
      })
    },
    [roomId],
  )

  const nextTurn = useCallback(async () => {
    if (!socketRef.current) return
    await request(socketRef.current, 'nextTurn', { roomId })
  }, [roomId])

  const pause = useCallback(async () => {
    if (!socketRef.current) return
    await request(socketRef.current, 'pauseDebate', { roomId })
  }, [roomId])

  const resume = useCallback(async () => {
    if (!socketRef.current) return
    await request(socketRef.current, 'resumeDebate', { roomId })
  }, [roomId])

  const endDebateAction = useCallback(async () => {
    if (!socketRef.current) return
    await request(socketRef.current, 'endDebate', { roomId })
  }, [roomId])

  const notifyParticipantChanged = useCallback(() => {
    if (!socketRef.current) return
    socketRef.current.emit('participantChanged', { roomId })
  }, [roomId])

  const onParticipantChanged = useCallback((callback: () => void) => {
    const socket = socketRef.current
    if (!socket) return () => {}
    socket.on('participantChanged', callback)
    return () => { socket.off('participantChanged', callback) }
  }, [])

  const isMyTurn = currentSpeaker?.userId === userId

  return {
    currentSpeaker,
    timeRemaining,
    isPaused,
    isMyTurn,
    debateStatus,
    debaters,
    startDebate: startDebateAction,
    nextTurn,
    pause,
    resume,
    endDebate: endDebateAction,
    notifyParticipantChanged,
    onParticipantChanged,
  }
}
