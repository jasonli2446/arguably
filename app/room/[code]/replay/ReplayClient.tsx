'use client'

import { useMemo, useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Clock,
  Users,
  MessageSquare,
  Download,
  BarChart3,
  ArrowLeft,
  Mic,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import FloatingNav from '@/components/FloatingNav'
import { useReplayPlayer, type PlaybackSpeed } from '@/hooks/useReplayPlayer'
import { exportAnalyticsCsv, type ReplayData } from '@/lib/actions/replay'
import { formatTime, getInitials } from '@/lib/utils'
import { useRouter } from 'next/navigation'

const TYPE_LABELS: Record<string, string> = {
  EXPERT_VS_CROWD: 'EXPERT VS CROWD',
  ONE_ON_ONE: '1v1',
  TEAM: 'TEAM',
  PANEL: 'PANEL',
}

const SPEED_OPTIONS: PlaybackSpeed[] = [1, 1.5, 2]

// Assign consistent colors to speakers
const SPEAKER_COLORS = [
  'text-red-400',
  'text-blue-400',
  'text-green-400',
  'text-yellow-400',
  'text-purple-400',
  'text-pink-400',
]

const SPEAKER_BG_COLORS = [
  'bg-red-600/20 border-red-600/40',
  'bg-blue-600/20 border-blue-600/40',
  'bg-green-600/20 border-green-600/40',
  'bg-yellow-600/20 border-yellow-600/40',
  'bg-purple-600/20 border-purple-600/40',
  'bg-pink-600/20 border-pink-600/40',
]

export default function ReplayClient({ data }: { data: ReplayData }) {
  const router = useRouter()
  const player = useReplayPlayer({ duration: data.debateDuration })
  const transcriptContainerRef = useRef<HTMLDivElement>(null)

  // Build speaker color map
  const speakerColorMap = useMemo(() => {
    const uniqueSpeakers = [...new Set(data.turns.map((t) => t.speakerId).filter(Boolean))]
    const map = new Map<string, number>()
    uniqueSpeakers.forEach((id, i) => {
      if (id) map.set(id, i % SPEAKER_COLORS.length)
    })
    return map
  }, [data.turns])

  // Visible transcripts based on current playback time
  const visibleTranscripts = useMemo(() => {
    return data.transcripts.filter((t) => t.timestamp <= player.currentTime)
  }, [data.transcripts, player.currentTime])

  // Current speaker at the current time
  const currentSpeaker = useMemo(() => {
    const activeTurns = data.turns.filter(
      (t) =>
        t.startOffset <= player.currentTime &&
        t.endOffset >= player.currentTime &&
        t.reason !== 'DEBATE_START'
    )
    return activeTurns.length > 0 ? activeTurns[activeTurns.length - 1] : null
  }, [data.turns, player.currentTime])

  // Auto-scroll transcript to bottom during playback
  useEffect(() => {
    if (player.isPlaying && transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight
    }
  }, [visibleTranscripts.length, player.isPlaying])

  const handleTranscriptClick = useCallback(
    (timestamp: number) => {
      player.seek(timestamp)
    },
    [player]
  )

  const handleExportCsv = useCallback(async () => {
    const csv = await exportAnalyticsCsv(data.session.code)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `debate-${data.session.code}-analytics.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [data.session.code])

  const { analytics } = data

  return (
    <div className="min-h-screen debate-container bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 dark">
      <div className="debate-texture fixed inset-0" />
      <FloatingNav />

      <main className="relative z-10 pt-28 pb-20">
        <div className="container mx-auto px-6">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <button
              onClick={() => router.push('/browse')}
              className="flex items-center gap-2 text-gray-400 hover:text-white debate-mono text-sm mb-4 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              BACK TO BROWSE
            </button>

            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <Badge variant="info" className="debate-mono text-xs">
                    {TYPE_LABELS[data.session.type] || data.session.type}
                  </Badge>
                  <Badge variant="secondary" className="debate-mono text-xs">
                    ENDED
                  </Badge>
                  <span className="debate-mono text-xs text-gray-500">
                    {data.session.code}
                  </span>
                </div>
                <h1 className="text-4xl md:text-5xl font-black text-white">
                  {data.session.name}
                </h1>
                {data.session.description && (
                  <p className="text-gray-400 mt-2">{data.session.description}</p>
                )}
              </div>
              <div className="text-right debate-mono text-sm text-gray-400">
                <p>Host: {data.session.host.realname ?? data.session.host.username}</p>
                {data.session.moderator && (
                  <p>Mod: {data.session.moderator.realname ?? data.session.moderator.username}</p>
                )}
              </div>
            </div>
          </motion.div>

          {/* Tabs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Tabs defaultValue="replay" className="w-full">
              <TabsList className="w-full md:w-auto">
                <TabsTrigger value="replay" className="flex items-center gap-2">
                  <Play className="w-4 h-4" />
                  REPLAY
                </TabsTrigger>
                <TabsTrigger value="analytics" className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  ANALYTICS
                </TabsTrigger>
              </TabsList>

              {/* === REPLAY TAB === */}
              <TabsContent value="replay">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Main transcript area */}
                  <div className="lg:col-span-8">
                    {/* Player controls */}
                    <Card className="debate-card mb-4">
                      <CardContent className="p-4">
                        <div className="flex flex-col gap-3">
                          {/* Current speaker */}
                          {currentSpeaker && (
                            <div className="flex items-center gap-2 text-sm">
                              <Mic className={`w-4 h-4 ${SPEAKER_COLORS[speakerColorMap.get(currentSpeaker.speakerId ?? '') ?? 0]}`} />
                              <span className="debate-mono text-gray-400">SPEAKING:</span>
                              <span className={`font-bold ${SPEAKER_COLORS[speakerColorMap.get(currentSpeaker.speakerId ?? '') ?? 0]}`}>
                                {currentSpeaker.speakerName}
                              </span>
                            </div>
                          )}

                          {/* Timeline scrubber */}
                          <div className="flex items-center gap-3">
                            <span className="debate-mono text-xs text-gray-400 w-12 text-right">
                              {formatTime(Math.floor(player.currentTime))}
                            </span>
                            <input
                              type="range"
                              min={0}
                              max={player.duration}
                              step={0.1}
                              value={player.currentTime}
                              onChange={(e) => player.seek(Number(e.target.value))}
                              className="flex-1 h-2 bg-gray-700 rounded-none appearance-none cursor-pointer
                                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-red-500 [&::-webkit-slider-thumb]:rounded-none
                                [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:bg-red-500 [&::-moz-range-thumb]:rounded-none [&::-moz-range-thumb]:border-0"
                            />
                            <span className="debate-mono text-xs text-gray-400 w-12">
                              {formatTime(Math.floor(player.duration))}
                            </span>
                          </div>

                          {/* Controls row */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => player.seek(Math.max(0, player.currentTime - 10))}
                                title="Back 10s"
                              >
                                <SkipBack className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="debate"
                                size="icon"
                                onClick={player.togglePlayPause}
                                className="bg-red-600 text-white border-red-600 hover:bg-red-700"
                              >
                                {player.isPlaying ? (
                                  <Pause className="w-5 h-5" />
                                ) : (
                                  <Play className="w-5 h-5" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  player.seek(Math.min(player.duration, player.currentTime + 10))
                                }
                                title="Forward 10s"
                              >
                                <SkipForward className="w-4 h-4" />
                              </Button>
                            </div>

                            {/* Speed selector */}
                            <div className="flex items-center gap-1">
                              {SPEED_OPTIONS.map((speed) => (
                                <button
                                  key={speed}
                                  onClick={() => player.setPlaybackSpeed(speed)}
                                  className={`px-2 py-1 text-xs debate-mono border transition-colors ${
                                    player.playbackSpeed === speed
                                      ? 'bg-red-600 border-red-600 text-white'
                                      : 'border-white/20 text-gray-400 hover:border-white/40 hover:text-white'
                                  }`}
                                >
                                  {speed}x
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Transcript display */}
                    <Card className="debate-card">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm debate-mono text-gray-400 flex items-center gap-2">
                          <MessageSquare className="w-4 h-4" />
                          TRANSCRIPT
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div
                          ref={transcriptContainerRef}
                          className="h-[500px] overflow-y-auto space-y-3 pr-2"
                        >
                          {data.transcripts.length === 0 ? (
                            <p className="text-gray-500 debate-mono text-sm text-center py-10">
                              No transcript available for this debate.
                            </p>
                          ) : visibleTranscripts.length === 0 ? (
                            <p className="text-gray-500 debate-mono text-sm text-center py-10">
                              Press play to begin replay...
                            </p>
                          ) : (
                            visibleTranscripts.map((segment) => {
                              const colorIdx = speakerColorMap.get(segment.speakerId) ?? 0
                              return (
                                <button
                                  key={segment.id}
                                  onClick={() => handleTranscriptClick(segment.timestamp)}
                                  className={`block w-full text-left p-3 border transition-colors cursor-pointer hover:bg-white/5 ${SPEAKER_BG_COLORS[colorIdx]}`}
                                >
                                  <div className="flex items-center gap-2 mb-1">
                                    <span
                                      className={`text-xs font-bold debate-mono ${SPEAKER_COLORS[colorIdx]}`}
                                    >
                                      {segment.speakerName}
                                    </span>
                                    <span className="text-xs debate-mono text-gray-500">
                                      {formatTime(Math.floor(segment.timestamp))}
                                    </span>
                                  </div>
                                  <p className="text-sm text-gray-200">{segment.content}</p>
                                </button>
                              )
                            })
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Sidebar: Turn timeline + participants */}
                  <div className="lg:col-span-4 space-y-4">
                    {/* Turn timeline */}
                    <Card className="debate-card">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm debate-mono text-gray-400 flex items-center gap-2">
                          <Clock className="w-4 h-4" />
                          TURN TIMELINE
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-1 max-h-[300px] overflow-y-auto">
                          {data.turns
                            .filter((t) => !(t.reason === 'DEBATE_START' && t.durationSec === 0))
                            .map((turn, i) => {
                              const colorIdx = speakerColorMap.get(turn.speakerId ?? '') ?? 0
                              const isActive =
                                player.currentTime >= turn.startOffset &&
                                player.currentTime <= turn.endOffset
                              return (
                                <button
                                  key={i}
                                  onClick={() => player.seek(turn.startOffset)}
                                  className={`w-full text-left px-3 py-2 text-xs transition-colors cursor-pointer ${
                                    isActive
                                      ? 'bg-white/10 border-l-2 border-red-500'
                                      : 'hover:bg-white/5 border-l-2 border-transparent'
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <span
                                      className={`font-bold debate-mono ${SPEAKER_COLORS[colorIdx]}`}
                                    >
                                      {turn.speakerName}
                                    </span>
                                    <span className="debate-mono text-gray-500">
                                      {formatTime(Math.floor(turn.startOffset))}
                                    </span>
                                  </div>
                                  <span className="text-gray-500 debate-mono">
                                    {Math.round(turn.durationSec)}s
                                  </span>
                                </button>
                              )
                            })}
                          {data.turns.filter((t) => !(t.reason === 'DEBATE_START' && t.durationSec === 0)).length === 0 && (
                            <p className="text-gray-500 debate-mono text-xs text-center py-4">
                              No turn data available.
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Participants */}
                    <Card className="debate-card">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm debate-mono text-gray-400 flex items-center gap-2">
                          <Users className="w-4 h-4" />
                          PARTICIPANTS ({data.participants.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {data.participants.map((p) => (
                            <div
                              key={p.userId}
                              className="flex items-center gap-3 py-1"
                            >
                              <div className="w-8 h-8 bg-gray-800 border border-white/20 flex items-center justify-center text-xs font-bold text-gray-400">
                                {getInitials(p.realname ?? p.username)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-white font-medium truncate">
                                  {p.realname ?? p.username}
                                </p>
                                <p className="text-xs debate-mono text-gray-500">
                                  {p.sessionRole}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </TabsContent>

              {/* === ANALYTICS TAB === */}
              <TabsContent value="analytics">
                {/* Session summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                  {[
                    {
                      label: 'DEBATE DURATION',
                      value: formatTime(Math.floor(analytics.session.debateDuration)),
                      icon: Clock,
                    },
                    {
                      label: 'TOTAL TURNS',
                      value: String(analytics.session.totalTurns),
                      icon: SkipForward,
                    },
                    {
                      label: 'TOTAL WORDS',
                      value: String(analytics.session.totalWords),
                      icon: MessageSquare,
                    },
                    {
                      label: 'PARTICIPANTS',
                      value: String(analytics.participants.length),
                      icon: Users,
                    },
                  ].map((stat) => (
                    <motion.div
                      key={stat.label}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-gray-900 border-2 border-white/20 p-4 text-center"
                    >
                      <stat.icon className="w-6 h-6 text-red-400 mx-auto mb-2" />
                      <div className="text-3xl font-black text-white mb-1">{stat.value}</div>
                      <div className="text-xs debate-mono text-gray-400">{stat.label}</div>
                    </motion.div>
                  ))}
                </div>

                {/* Per-participant stats */}
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-black text-white">PARTICIPANT STATS</h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportCsv}
                    className="debate-mono text-xs"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    EXPORT CSV
                  </Button>
                </div>

                {analytics.participants.length === 0 ? (
                  <Card className="debate-card">
                    <CardContent className="py-10 text-center">
                      <p className="text-gray-500 debate-mono">
                        No participant analytics available.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid md:grid-cols-2 gap-4">
                    {analytics.participants.map((p) => {
                      const colorIdx = speakerColorMap.get(p.speakerId) ?? 0
                      return (
                        <motion.div
                          key={p.speakerId}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                        >
                          <Card className="debate-card h-full">
                            <CardHeader className="pb-2">
                              <div className="flex items-center gap-3">
                                <div
                                  className={`w-10 h-10 border-2 flex items-center justify-center text-sm font-bold ${SPEAKER_BG_COLORS[colorIdx]} ${SPEAKER_COLORS[colorIdx]}`}
                                >
                                  {getInitials(p.speakerName)}
                                </div>
                                <div>
                                  <CardTitle className={`text-lg ${SPEAKER_COLORS[colorIdx]}`}>
                                    {p.speakerName}
                                  </CardTitle>
                                  <p className="text-xs debate-mono text-gray-500">
                                    {p.speakingTimePercent}% of debate
                                  </p>
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent>
                              {/* Speaking time bar */}
                              <div className="mb-4">
                                <div className="w-full h-2 bg-gray-800">
                                  <div
                                    className="h-full bg-red-600 transition-all"
                                    style={{ width: `${Math.min(100, p.speakingTimePercent)}%` }}
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                  <p className="text-xs debate-mono text-gray-500">SPEAKING TIME</p>
                                  <p className="text-white font-bold">
                                    {formatTime(Math.floor(p.totalSpeakingTime))}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs debate-mono text-gray-500">TURNS</p>
                                  <p className="text-white font-bold">{p.turnCount}</p>
                                </div>
                                <div>
                                  <p className="text-xs debate-mono text-gray-500">AVG TURN</p>
                                  <p className="text-white font-bold">
                                    {formatTime(Math.floor(p.avgTurnDuration))}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs debate-mono text-gray-500">LONGEST TURN</p>
                                  <p className="text-white font-bold">
                                    {formatTime(Math.floor(p.longestTurn))}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs debate-mono text-gray-500">WORDS SPOKEN</p>
                                  <p className="text-white font-bold">{p.wordsSpoken}</p>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      )
                    })}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </motion.div>
        </div>
      </main>
    </div>
  )
}
