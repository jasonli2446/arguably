'use client'

import { useRef, useEffect } from 'react'

interface VideoPanelProps {
  stream: MediaStream | null
  muted: boolean
  label: string
  className?: string
}

export default function VideoPanel({ stream, muted, label, className = '' }: VideoPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream ?? null
    }
  }, [stream])

  return (
    <div className={`relative w-full h-full bg-gradient-to-br from-gray-900 to-gray-700 rounded-md border-2 border-black overflow-hidden ${className}`}>
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 bg-gray-600 rounded-full flex items-center justify-center">
            <span className="text-white/60 text-2xl font-bold debate-mono">
              {label.charAt(0).toUpperCase()}
            </span>
          </div>
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1">
        <p className="text-white text-xs debate-mono truncate">{label}</p>
      </div>
    </div>
  )
}
