'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ClaimView, SourceView } from '@/lib/claims'

interface UseLiveClaimsOptions {
  sessionId: string
  initialClaims: ClaimView[]
}

const URL_PATTERN = /^https?:\/\//

function validateSources(raw: unknown): SourceView[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (s): s is SourceView =>
      s != null &&
      typeof s === 'object' &&
      typeof s.title === 'string' &&
      typeof s.url === 'string' &&
      typeof s.description === 'string' &&
      URL_PATTERN.test(s.url),
  )
}

function mapRealtimeClaim(row: Record<string, unknown>, speakerName: string): ClaimView {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    transcriptSegmentId: String(row.transcript_segment_id),
    speakerName,
    claimText: String(row.claim_text),
    analysis: String(row.analysis),
    confidence: Number(row.confidence),
    sources: validateSources(row.sources),
    provider: String(row.provider),
    providerModel: String(row.provider_model),
    createdAt: new Date(String(row.created_at)).toISOString(),
  }
}

export function useLiveClaims({ sessionId, initialClaims }: UseLiveClaimsOptions) {
  const [claims, setClaims] = useState<ClaimView[]>(initialClaims)

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`claims:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'DetectedClaim',
          filter: `session_id=eq.${sessionId}`,
        },
        async (payload) => {
          const row = payload.new as Record<string, unknown>
          const segmentId = String(row.transcript_segment_id)

          // Fetch speaker name from the linked transcript segment
          let speakerName = 'Unknown'
          try {
            const { data } = await supabase
              .from('TranscriptSegment')
              .select('speaker_name')
              .eq('id', segmentId)
              .single()
            if (data?.speaker_name) {
              speakerName = data.speaker_name
            }
          } catch {
            // Fall back to 'Unknown'
          }

          const claim = mapRealtimeClaim(row, speakerName)
          setClaims((prev) => {
            if (prev.some((c) => c.id === claim.id)) return prev
            return [...prev, claim]
          })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [sessionId])

  return { claims }
}
