'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { TranscriptSegmentView } from '@/lib/transcripts'

interface UseLiveTranscriptOptions {
  sessionId: string
  currentUserId: string
  localStream: MediaStream | null
  enabled: boolean
  audioMuted: boolean
  initialSegments: TranscriptSegmentView[]
}

const TRANSCRIPT_CHUNK_MS = 4000

function sortSegments(segments: TranscriptSegmentView[]) {
  return [...segments].sort((a, b) => {
    const startedDelta = new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
    if (startedDelta !== 0) return startedDelta
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })
}

function mergeSegmentList(
  existing: TranscriptSegmentView[],
  incoming: TranscriptSegmentView,
): TranscriptSegmentView[] {
  const next = existing.filter((segment) => segment.id !== incoming.id)
  next.push(incoming)
  return sortSegments(next)
}

function getSupportedMimeType() {
  if (typeof MediaRecorder === 'undefined') {
    return null
  }

  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ]

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? null
}

function mapRealtimeSegment(row: Record<string, unknown>): TranscriptSegmentView {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    speakerId: String(row.speaker_id),
    speakerName: String(row.speaker_name),
    text: String(row.text),
    chunkIndex: Number(row.chunk_index),
    startedAt: new Date(String(row.started_at)).toISOString(),
    endedAt: new Date(String(row.ended_at)).toISOString(),
    isFinal: Boolean(row.is_final),
    provider: String(row.provider),
    providerModel: String(row.provider_model),
    createdAt: new Date(String(row.created_at)).toISOString(),
  }
}

export function useLiveTranscript({
  sessionId,
  currentUserId,
  localStream,
  enabled,
  audioMuted,
  initialSegments,
}: UseLiveTranscriptOptions) {
  const [segments, setSegments] = useState<TranscriptSegmentView[]>(() => sortSegments(initialSegments))
  const [uploadError, setUploadError] = useState<string | null>(null)
  const uploadQueueRef = useRef(Promise.resolve())
  const segmentsRef = useRef<TranscriptSegmentView[]>(sortSegments(initialSegments))

  useEffect(() => {
    segmentsRef.current = segments
  }, [segments])

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`transcripts:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'TranscriptSegment',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          setSegments((prev) => mergeSegmentList(prev, mapRealtimeSegment(payload.new as Record<string, unknown>)))
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [sessionId])

  const setupError = useMemo(() => {
    if (!enabled || !localStream) {
      return null
    }

    const audioTrack = localStream.getAudioTracks()[0]
    if (!audioTrack) {
      return 'No microphone track available for transcription.'
    }

    if (typeof MediaRecorder === 'undefined') {
      return 'This browser does not support live transcription recording.'
    }

    if (!getSupportedMimeType()) {
      return 'This browser cannot encode microphone audio for transcription.'
    }

    return null
  }, [enabled, localStream])

  // Recording effect: starts/stops based on enabled, localStream, and audioMuted
  useEffect(() => {
    if (!enabled || !localStream || setupError || audioMuted) {
      return
    }

    const audioTrack = localStream.getAudioTracks()[0]
    if (!audioTrack || typeof MediaRecorder === 'undefined') return

    const mimeType = getSupportedMimeType()
    if (!mimeType) return

    uploadQueueRef.current = Promise.resolve()

    const audioStream = new MediaStream([audioTrack.clone()])
    let cancelled = false
    let currentChunkIndex = segmentsRef.current
      .filter((segment) => segment.speakerId === currentUserId)
      .reduce((max, segment) => Math.max(max, segment.chunkIndex), -1) + 1
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let activeRecorder: MediaRecorder | null = null

    // Derive file extension from actual MIME type for cross-browser compatibility
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'

    function queueUpload(
      audioBlob: Blob,
      uploadChunkIndex: number,
      chunkStartedAt: number,
      chunkEndedAt: number,
    ) {
      uploadQueueRef.current = uploadQueueRef.current.then(async () => {
        const formData = new FormData()
        formData.append('sessionId', sessionId)
        formData.append('chunkIndex', String(uploadChunkIndex))
        formData.append('startedAt', String(chunkStartedAt))
        formData.append('endedAt', String(chunkEndedAt))
        formData.append('audio', audioBlob, `segment-${uploadChunkIndex}.${ext}`)

        const response = await fetch('/api/transcripts', {
          method: 'POST',
          body: formData,
        })

        const json = await response.json().catch(() => null)

        if (!response.ok) {
          const message =
            json &&
            typeof json === 'object' &&
            'error' in json &&
            typeof json.error === 'string'
              ? json.error
              : 'Failed to transcribe audio.'

          throw new Error(message)
        }

        if (
          json &&
          typeof json === 'object' &&
          'segment' in json &&
          json.segment &&
          typeof json.segment === 'object'
        ) {
          setUploadError(null)
          setSegments((prev) => mergeSegmentList(prev, json.segment as TranscriptSegmentView))
        }
      }).catch((uploadError: unknown) => {
        if (!cancelled) {
          setUploadError(uploadError instanceof Error ? uploadError.message : 'Failed to transcribe audio.')
        }
      })
    }

    function recordNextChunk() {
      if (cancelled) return

      const recorder = new MediaRecorder(audioStream, { mimeType: mimeType! })
      activeRecorder = recorder
      const chunkStartedAt = Date.now()

      recorder.addEventListener(
        'dataavailable',
        (event) => {
          if (cancelled || event.data.size === 0) {
            return
          }

          const chunkEndedAt = Date.now()
          const uploadChunkIndex = currentChunkIndex
          currentChunkIndex += 1
          queueUpload(event.data, uploadChunkIndex, chunkStartedAt, chunkEndedAt)
        },
        { once: true },
      )

      recorder.addEventListener(
        'stop',
        () => {
          activeRecorder = null
          if (!cancelled) {
            recordNextChunk()
          }
        },
        { once: true },
      )

      recorder.start()
      timeoutId = setTimeout(() => {
        if (recorder.state !== 'inactive') {
          recorder.stop()
        }
      }, TRANSCRIPT_CHUNK_MS)
    }

    recordNextChunk()

    return () => {
      cancelled = true

      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      if (activeRecorder && activeRecorder.state !== 'inactive') {
        activeRecorder.stop()
      }

      audioStream.getTracks().forEach((track) => track.stop())
    }
  }, [currentUserId, enabled, localStream, sessionId, setupError, audioMuted])

  return {
    segments,
    isCapturing: Boolean(enabled && localStream && !setupError && !audioMuted),
    error: setupError ?? uploadError,
  }
}
