'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  getQueue as getQueueAction,
  joinQueue as joinQueueAction,
  leaveQueue as leaveQueueAction,
} from '@/lib/actions/queue'

export interface QueueEntry {
  id: string
  userId: string
  rank: number
  displayName: string
  addedAt: string
}

interface UseQueueChannelOptions {
  sessionId: string
  userId: string | null
}

export function useQueueChannel({ sessionId, userId }: UseQueueChannelOptions) {
  const [queue, setQueue] = useState<QueueEntry[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchQueue = useCallback(async () => {
    try {
      const entries = await getQueueAction(sessionId)
      setQueue(entries)
    } catch (err) {
      console.error('Failed to fetch queue:', err)
    }
  }, [sessionId])

  const debouncedFetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(fetchQueue, 500)
  }, [fetchQueue])

  // Subscribe to Realtime + fetch initial state
  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`queue:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'AudienceQueue',
          filter: `session_id=eq.${sessionId}`,
        },
        () => { debouncedFetch() },
      )
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await fetchQueue()
        }
      })

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      supabase.removeChannel(channel)
    }
  }, [sessionId, fetchQueue, debouncedFetch])

  const myPosition = userId
    ? queue.find((e) => e.userId === userId)?.rank ?? null
    : null

  const isInQueue = myPosition !== null

  const joinQueue = useCallback(async () => {
    await joinQueueAction(sessionId)
    await fetchQueue()
  }, [sessionId, fetchQueue])

  const leaveQueue = useCallback(async () => {
    await leaveQueueAction(sessionId)
    await fetchQueue()
  }, [sessionId, fetchQueue])

  return {
    queue,
    myPosition,
    isInQueue,
    joinQueue,
    leaveQueue,
  }
}
