'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  getDebateState as getDebateStateAction,
  startDebate as startDebateAction,
  advanceTurn as advanceTurnAction,
  advanceTurnIfExpired,
  pauseDebate as pauseDebateAction,
  resumeDebate as resumeDebateAction,
  endDebate as endDebateAction,
} from '@/lib/actions/debate'

interface DebateParticipant {
  userId: string
  displayName: string
}

type DebateStatus = 'idle' | 'live' | 'paused' | 'ended'

interface DebateRow {
  session_id: string
  debater_order: DebateParticipant[]
  current_index: number
  turn_length: number
  turn_ends_at: number | null
  is_paused: boolean
  paused_time_remaining: number
}

interface UseDebateChannelOptions {
  sessionId: string
  userId: string | null
}

export function useDebateChannel({ sessionId, userId }: UseDebateChannelOptions) {
  const [debaters, setDebaters] = useState<DebateParticipant[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [turnEndsAt, setTurnEndsAt] = useState<number | null>(null)
  const [isPaused, setIsPaused] = useState(false)
  const [debateStatus, setDebateStatus] = useState<DebateStatus>('idle')
  const [timeRemaining, setTimeRemaining] = useState(0)
  const timerFiredRef = useRef(false)

  const currentSpeaker = debaters[currentIndex] ?? null
  const isMyTurn = currentSpeaker?.userId === userId

  const applyState = useCallback((row: DebateRow) => {
    setDebaters(row.debater_order)
    setCurrentIndex(row.current_index)
    setTurnEndsAt(row.turn_ends_at)
    setIsPaused(row.is_paused)
    setDebateStatus(row.is_paused ? 'paused' : 'live')
    timerFiredRef.current = false

    if (row.is_paused) {
      setTimeRemaining(Math.ceil(row.paused_time_remaining))
    }
  }, [])

  // Subscribe to Realtime + fetch initial state
  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`debate:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'DebateState',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setDebateStatus('ended')
            setDebaters([])
            setTurnEndsAt(null)
            setTimeRemaining(0)
            return
          }
          applyState(payload.new as unknown as DebateRow)
        },
      )
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          const state = await getDebateStateAction(sessionId)
          if (state) applyState(state as DebateRow)
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [sessionId, applyState])

  // Timer countdown
  useEffect(() => {
    if (debateStatus !== 'live' || isPaused || turnEndsAt === null) return

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((turnEndsAt - Date.now()) / 1000))
      setTimeRemaining(remaining)

      if (remaining <= 0 && !timerFiredRef.current) {
        timerFiredRef.current = true
        advanceTurnIfExpired(sessionId).catch(console.error)
      }
    }

    tick()
    const interval = setInterval(tick, 250)
    return () => clearInterval(interval)
  }, [debateStatus, isPaused, turnEndsAt, sessionId])

  // Actions
  const startDebate = useCallback(
    (debaterList: DebateParticipant[], turnLen: number) =>
      startDebateAction(sessionId, debaterList, turnLen),
    [sessionId],
  )
  const nextTurn = useCallback(() => advanceTurnAction(sessionId), [sessionId])
  const pause = useCallback(() => pauseDebateAction(sessionId), [sessionId])
  const resume = useCallback(() => resumeDebateAction(sessionId), [sessionId])
  const endDebate = useCallback(() => endDebateAction(sessionId), [sessionId])

  return {
    currentSpeaker,
    timeRemaining,
    isPaused,
    isMyTurn,
    debateStatus,
    debaters,
    startDebate,
    nextTurn,
    pause,
    resume,
    endDebate,
  }
}
