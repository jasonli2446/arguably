"use client"

import { useState, useRef, useCallback, useEffect } from "react"

export type PlaybackSpeed = 1 | 1.5 | 2

interface UseReplayPlayerOptions {
  /** Total debate duration in seconds */
  duration: number
}

export function useReplayPlayer({ duration }: UseReplayPlayerOptions) {
  const [currentTime, setCurrentTime] = useState(0) // seconds from debate start
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1)

  const lastTickRef = useRef<number>(0)
  const rafRef = useRef<number | null>(null)
  const playbackSpeedRef = useRef(playbackSpeed)
  const durationRef = useRef(duration)

  // Keep refs in sync with state
  useEffect(() => {
    playbackSpeedRef.current = playbackSpeed
  }, [playbackSpeed])

  useEffect(() => {
    durationRef.current = duration
  }, [duration])

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      return
    }

    lastTickRef.current = performance.now()

    function tick() {
      const now = performance.now()
      const delta = (now - lastTickRef.current) / 1000
      lastTickRef.current = now

      setCurrentTime((prev) => {
        const next = prev + delta * playbackSpeedRef.current
        if (next >= durationRef.current) {
          setIsPlaying(false)
          return durationRef.current
        }
        return next
      })

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [isPlaying])

  const play = useCallback(() => {
    if (currentTime >= duration) {
      setCurrentTime(0)
    }
    setIsPlaying(true)
  }, [currentTime, duration])

  const pause = useCallback(() => {
    setIsPlaying(false)
  }, [])

  const seek = useCallback(
    (time: number) => {
      setCurrentTime(Math.max(0, Math.min(time, duration)))
    },
    [duration]
  )

  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      pause()
    } else {
      play()
    }
  }, [isPlaying, play, pause])

  return {
    currentTime,
    isPlaying,
    playbackSpeed,
    setPlaybackSpeed,
    play,
    pause,
    seek,
    togglePlayPause,
    duration,
  }
}
