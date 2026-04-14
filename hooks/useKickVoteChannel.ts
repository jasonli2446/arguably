'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  castKickVote as castKickVoteAction,
  removeKickVote as removeKickVoteAction,
  getKickVotes as getKickVotesAction,
} from '@/lib/actions/queue'

export interface KickVoteState {
  voteCount: number
  requiredVotes: number
  userHasVoted: boolean
}

interface UseKickVoteChannelOptions {
  sessionId: string
  userId: string | null
  debaterIds: string[]
}

export function useKickVoteChannel({
  sessionId,
  userId,
  debaterIds,
}: UseKickVoteChannelOptions) {
  const [voteStates, setVoteStates] = useState<Record<string, KickVoteState>>({})
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchVotes = useCallback(async () => {
    if (!userId || debaterIds.length === 0) return
    try {
      const results = await Promise.all(
        debaterIds.map(async (targetId) => {
          const data = await getKickVotesAction(sessionId, targetId)
          return [targetId, data] as const
        })
      )
      setVoteStates(Object.fromEntries(results))
    } catch (err) {
      console.error('Failed to fetch kick votes:', err)
    }
  }, [sessionId, userId, debaterIds])

  const debouncedFetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(fetchVotes, 500)
  }, [fetchVotes])

  // Subscribe to Vote table changes
  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`votes:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'Vote',
          filter: `session_id=eq.${sessionId}`,
        },
        () => { debouncedFetch() },
      )
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await fetchVotes()
        }
      })

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      supabase.removeChannel(channel)
    }
  }, [sessionId, fetchVotes, debouncedFetch])

  const castVote = useCallback(
    (targetUserId: string) => castKickVoteAction(sessionId, targetUserId),
    [sessionId],
  )

  const removeVote = useCallback(
    (targetUserId: string) => removeKickVoteAction(sessionId, targetUserId),
    [sessionId],
  )

  return {
    voteStates,
    castVote,
    removeVote,
  }
}
