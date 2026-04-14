'use client'

import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Users,
  Clock,
  Mic,
  MicOff,
  Shield,
  MessageSquare,
  BarChart3,
  Pause,
  Play,
  SkipForward,
  Volume2,
  Video,
  VideoOff,
  Settings,
  Loader2,
  Swords,
  Hand,
  ArrowUp,
  ThumbsDown,
  Crown,
} from 'lucide-react'
import { useMediasoup } from '@/hooks/useMediasoup'
import { useDebateChannel } from '@/hooks/useDebateChannel'
import { useQueueChannel } from '@/hooks/useQueueChannel'
import { useKickVoteChannel } from '@/hooks/useKickVoteChannel'
import { createClient } from '@/lib/supabase/client'
import VideoPanel from '@/components/VideoPanel'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { userStub, getInitials, formatTime } from '@/lib/utils'
import { leaveSession, updateSessionStatus, joinSession, joinSessionAsDebater, kickParticipant, assignModerator } from '@/lib/actions/session'
import { promoteFromQueue } from '@/lib/actions/queue'
import { useRouter } from 'next/navigation'
import { SessionRole, SessionStatus, SessionType } from '@/lib/generated/prisma'

interface SessionData {
  id: string
  code: string
  name: string
  type: SessionType
  status: SessionStatus
  turnLength: number
  debaterCapacityProponent: number | null
  debaterCapacityOpponent: number | null
  debaterCapacityPanel: number | null
  audienceCapacity: number
  kickThreshold: number
  host: { id: string; username: string; realname: string | null }
  moderator: { id: string; username: string; realname: string | null } | null
  participatesIns: {
    userId: string
    sessionRole: SessionRole
    user: { id: string; username: string; realname: string | null }
  }[]
}

export default function RoomClient({
  session,
  currentUserId,
  currentRole,
  currentUsername,
}: {
  session: SessionData
  currentUserId: string
  currentRole: SessionRole
  currentUsername: string
}) {
  const router = useRouter()
  const [isPaused, setIsPaused] = useState(session.status === SessionStatus.PAUSED)
  const [timeRemaining, setTimeRemaining] = useState(session.turnLength)
  const [isJoining, setIsJoining] = useState(false)
  const [showDebaterOptions, setShowDebaterOptions] = useState(false)

  const isModeratorOrCreator = currentRole === SessionRole.MODERATOR || currentRole === SessionRole.HOST
  const isHost = currentRole === SessionRole.HOST
  const isParticipant = currentRole !== null
  const isDebater = currentRole === SessionRole.DEBATER || currentRole === SessionRole.HOST

  const {
    connectionState,
    localStream,
    remoteStreams,
    audioMuted,
    videoOff,
    toggleMute,
    toggleVideo,
    disconnect: disconnectSfu,
  } = useMediasoup({
    sfuUrl: process.env.NEXT_PUBLIC_SFU_URL,
    roomId: session.code,
    displayName: currentUsername,
    enabled: isDebater,
  })

  const debate = useDebateChannel({
    sessionId: session.id,
    userId: currentUserId,
  })

  const queueChannel = useQueueChannel({
    sessionId: session.id,
    userId: currentUserId,
  })

  const isAudience = currentRole === SessionRole.AUDIENCE
  const isExpertVsCrowd = session.type === SessionType.EXPERT_VS_CROWD

  // Compute debater IDs for kick-vote tracking (exclude host)
  const debaterIdsForVote = useMemo(() => {
    return debate.debaters
      .filter((d) => d.userId !== session.host.id)
      .map((d) => d.userId)
  }, [debate.debaters, session.host.id])

  const kickVoteChannel = useKickVoteChannel({
    sessionId: session.id,
    userId: currentUserId,
    debaterIds: debaterIdsForVote,
  })

  // Refresh page when participants change (via Supabase Realtime)
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`participants:${session.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'ParticipatesIn',
          filter: `session_id=eq.${session.id}`,
        },
        () => { router.refresh() },
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [session.id, router])

  // Auto-join as audience when a logged-in non-participant views the room
  useEffect(() => {
    if (!currentUserId || isParticipant) return

    let cancelled = false
    async function autoJoin() {
      try {
        await joinSession(session.id)
        if (!cancelled) {
          router.refresh()
        }
      } catch (err) {
        console.error('Auto-join failed:', err)
      }
    }
    autoJoin()
    return () => { cancelled = true }
  }, [currentUserId, isParticipant, session.id, router])

  // Clean up DB on tab close / navigate away
  useEffect(() => {
    if (!isParticipant) return

    const handleBeforeUnload = () => {
      navigator.sendBeacon(
        '/api/leave-session',
        new Blob([JSON.stringify({ sessionId: session.id })], { type: 'application/json' })
      )
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isParticipant, session.id])

  // Filter participants by role
  const moderators = session.participatesIns.filter(
    (p) => p.sessionRole === SessionRole.MODERATOR || p.sessionRole === SessionRole.HOST
  )
  const debaters = session.participatesIns.filter(
    (p) => p.sessionRole === SessionRole.DEBATER || p.sessionRole === SessionRole.HOST
  )
  const audience = session.participatesIns.filter(
    (p) => p.sessionRole === SessionRole.AUDIENCE
  )

  // Calculate total capacities
  const getTotalDebaterCapacity = () => {
    if (session.type === SessionType.PANEL) {
      return session.debaterCapacityPanel ?? 0
    }
    return (session.debaterCapacityProponent ?? 0) + (session.debaterCapacityOpponent ?? 0)
  }

  const totalDebaterCapacity = getTotalDebaterCapacity()

  // Check if room can accept another debater
  const canJoinAsDebater = debaters.length < totalDebaterCapacity

  // Current user is audience and could become a debater
  const canUpgradeToDebater =
    currentRole === SessionRole.AUDIENCE && canJoinAsDebater

  // Check proponent/opponent specific availability
  const proponentsFull = 
    session.type !== SessionType.PANEL && 
    (session.debaterCapacityProponent ?? 0) > 0 &&
    debaters.filter(d => d.sessionRole === SessionRole.DEBATER).length >= (session.debaterCapacityProponent ?? 0)
  
  const opponentsFull = 
    session.type !== SessionType.PANEL &&
    (session.debaterCapacityOpponent ?? 0) > 0 &&
    debaters.filter(d => d.sessionRole === SessionRole.DEBATER).length >= totalDebaterCapacity

  // Use hook's timer when debate is active
  const displayTime =
    debate.debateStatus === 'live' || debate.debateStatus === 'paused'
      ? debate.timeRemaining
      : session.turnLength

  // Timer countdown
  useEffect(() => {
    if (!isPaused && session.status === SessionStatus.LIVE) {
      const interval = setInterval(() => {
        setTimeRemaining((prev) => (prev > 0 ? prev - 1 : 0))
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [isPaused, session.status])

  async function handleLeave() {
    disconnectSfu()
    try {
      if (queueChannel.isInQueue) {
        await queueChannel.leaveQueue()
      }
      await leaveSession(session.id)
      router.push('/browse')
    } catch (err) {
      console.error('Failed to leave:', err)
      router.push('/browse')
    }
  }

  async function handleTogglePause() {
    try {
      if (isPaused) {
        await debate.resume()
        await updateSessionStatus(session.id, 'LIVE')
      } else {
        await debate.pause()
        await updateSessionStatus(session.id, 'PAUSED')
      }
    } catch (err) {
      console.error('Failed to toggle pause:', err)
    }
  }

  async function handleEndSession() {
    try {
      await debate.endDebate()
      await updateSessionStatus(session.id, SessionStatus.ENDED)
      router.push('/browse')
    } catch (err) {
      console.error('Failed to end session:', err)
    }
  }

  async function handleStartSession() {
    try {
      // Build debater list from participants with HOST or DEBATER role
      const debaterList = debaters.map((p) => ({
        userId: p.user.id,
        displayName: p.user.realname || p.user.username,
      }))

      if (isExpertVsCrowd) {
        // Expert vs Crowd: pass only the expert (host), backend auto-promotes from queue
        const expert = debaterList.find((d) => d.userId === session.host.id) ?? debaterList[0]
        await debate.startDebate([expert], session.turnLength)
      } else if (debaterList.length >= 2) {
        await debate.startDebate(debaterList, session.turnLength)
      }

      await updateSessionStatus(session.id, SessionStatus.LIVE)
      router.refresh()
    } catch (err) {
      console.error('Failed to start session:', err)
    }
  }

  async function handleUpgradeToDebater(isProponent: boolean) {
    setIsJoining(true)
    try {
      await joinSessionAsDebater(session.id, isProponent)
      router.refresh()
    } catch (err) {
      console.error('Failed to upgrade to debater:', err)
    } finally {
      setIsJoining(false)
      setShowDebaterOptions(false)
    }
  }

  async function handleAssignModerator(userId: string) {
    try {
      await assignModerator(session.id, userId)
      router.refresh()
    } catch (err) {
      console.error('Failed to assign moderator:', err)
    }
  }

  async function handleNextTurn() {
    try {
      await debate.nextTurn()
    } catch (err) {
      console.error('Failed to advance turn:', err)
    }
  }

  async function handleKick(userId: string) {
    try {
      await kickParticipant(session.id, userId)
      router.refresh()
    } catch (err) {
      console.error('Failed to kick participant:', err)
    }
  }

  const displayName = (p: { id: string; username: string; realname: string | null }) =>
    p.realname || p.username

  // Determine the status indicator
  const isDebateLive = debate.debateStatus === 'live' || debate.debateStatus === 'paused'
  const statusDot = isDebateLive ? 'bg-red-600 animate-pulse' : 'bg-gray-500'

  // Get debater capacity message
  const getDebaterCapacityMessage = () => {
    if (session.type === SessionType.PANEL) {
      return `Need ${(session.debaterCapacityPanel ?? 0) - debaters.length} more panelist${(session.debaterCapacityPanel ?? 0) - debaters.length === 1 ? '' : 's'}`
    } else {
      return `Need ${totalDebaterCapacity - debaters.length} more debater${totalDebaterCapacity - debaters.length === 1 ? '' : 's'}`
    }
  }

  // Check if debate can start
  const canStartDebate = isExpertVsCrowd
    ? debaters.length >= 1 && queueChannel.queue.length >= 1
    : session.type === SessionType.ONE_ON_ONE
      ? debaters.length === 2
      : debaters.length >= 2

  // Timer color based on remaining time
  const timerColorClass = displayTime <= 10
    ? 'text-red-500 animate-pulse'
    : displayTime <= 30
    ? 'text-orange-400'
    : 'text-white'

  return (
    <div className="min-h-screen debate-container bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 dark">
      <div className="debate-texture fixed inset-0" />

      <header className="relative z-10 border-b-2 border-white/20 bg-gray-900/90 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h1 className="text-xl font-bold debate-title text-white">{session.code}</h1>
              <span
                className={`debate-badge text-white ${
                  session.status === SessionStatus.LIVE
                    ? 'bg-red-600'
                    : session.status === SessionStatus.WAITING
                    ? 'bg-yellow-500'
                    : session.status === SessionStatus.PAUSED
                    ? 'bg-gray-500'
                    : 'bg-gray-700'
                }`}
              >
                {session.status}
              </span>
              <span className="debate-mono text-sm text-gray-400">{session.name}</span>
            </div>
            <div className="flex items-center space-x-2">
              <Button variant="ghost" size="sm" className="debate-button">
                <Settings className="w-4 h-4" />
              </Button>
              {isParticipant && (
                <Button variant="outline" size="sm" className="debate-button" onClick={handleLeave}>
                  EXIT ROOM
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 min-h-[calc(100vh-60px)]">
        <div className="container mx-auto px-6 py-4">
          <div className="grid grid-cols-12 gap-4">
            {/* Main Stage */}
            <div className="col-span-8 space-y-4">
              {/* YOUR TURN banner */}
              {debate.isMyTurn && debate.debateStatus === 'live' && (
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-gradient-to-r from-yellow-500 to-yellow-600 border-2 border-yellow-700 p-3 text-center shadow-[4px_4px_0px_rgba(0,0,0,0.3)]"
                >
                  <p className="text-black font-bold debate-title text-lg">YOUR TURN TO SPEAK</p>
                </motion.div>
              )}

              <div className="min-h-[400px]">
                <Card className="debate-card border-2">
                  <CardHeader className="border-b-2 border-white/20">
                    <div className="flex items-center justify-between">
                      <CardTitle className="debate-title flex items-center text-white">
                        <div className={`w-3 h-3 rounded-full mr-3 ${statusDot}`} />
                        {session.status === SessionStatus.WAITING
                          ? 'WAITING TO START'
                          : debate.currentSpeaker
                          ? 'CURRENT SPEAKER'
                          : 'DEBATE STAGE'}
                      </CardTitle>
                      <div className={`flex items-center space-x-2 ${timerColorClass}`}>
                        <Clock className="w-4 h-4" />
                        <span className="debate-mono font-bold">
                          {formatTime(displayTime)}
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-6">
                    {session.status === SessionStatus.WAITING ? (
                      <div className="flex flex-col items-center justify-center py-12">
                        <div className="text-center">
                          <Users className="w-16 h-16 text-white/20 mx-auto mb-4" />
                          <p className="text-2xl font-bold debate-title text-white mb-2">WAITING FOR PARTICIPANTS</p>
                          <p className="text-gray-400 debate-mono mb-6">
                            {session.participatesIns.length} / {totalDebaterCapacity + session.audienceCapacity + 1} joined
                          </p>
                          {debaters.length < totalDebaterCapacity && (
                            <p className="text-yellow-400 debate-mono text-sm mb-4">
                              {getDebaterCapacityMessage()}
                            </p>
                          )}
                          {isModeratorOrCreator && (
                            <Button
                              className="debate-button bg-red-600 text-white border-red-700"
                              onClick={handleStartSession}
                              disabled={!canStartDebate}
                            >
                              START DEBATE
                            </Button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col space-y-4">
                        {/* Debater display */}
                        {isDebateLive && debate.debaters.length >= 2 ? (
                          <div className="flex items-center justify-center gap-6">
                            {debate.debaters.map((d, i) => {
                              const isSpeaking = debate.currentSpeaker?.userId === d.userId
                              const isHostDebater = d.userId === session.host.id
                              const voteState = kickVoteChannel.voteStates[d.userId]
                              const canVoteToKick = isAudience && !isHostDebater
                              return (
                                <div
                                  key={d.userId}
                                  className={`flex flex-col p-3 border-2 transition-all ${
                                    isSpeaking
                                      ? 'border-yellow-400 bg-yellow-400/10 shadow-[0_0_15px_rgba(250,204,21,0.3)]'
                                      : 'border-white/20 opacity-60'
                                  }`}
                                >
                                  <div className="flex items-center space-x-3">
                                    <div
                                      className={`w-14 h-14 border-2 border-black flex items-center justify-center text-white font-bold text-lg ${
                                        i === 0
                                          ? 'bg-gradient-to-br from-red-600 to-red-800'
                                          : 'bg-gradient-to-br from-blue-600 to-blue-800'
                                      }`}
                                    >
                                      {getInitials(d.displayName)}
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <h3 className="text-lg font-bold debate-title text-white">
                                          {d.displayName}
                                        </h3>
                                        {isExpertVsCrowd && i === 0 && (
                                          <span className="debate-badge bg-purple-600 text-white text-xs flex items-center gap-1">
                                            <Crown className="w-3 h-3" /> EXPERT
                                          </span>
                                        )}
                                        {isExpertVsCrowd && i === 1 && (
                                          <span className="debate-badge bg-orange-600 text-white text-xs">
                                            CHALLENGER
                                          </span>
                                        )}
                                      </div>
                                      {isSpeaking && (
                                        <span className="debate-badge bg-yellow-400 text-black text-xs">
                                          SPEAKING
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  {/* Kick vote UI */}
                                  {canVoteToKick && voteState && (
                                    <div className="mt-2 pt-2 border-t border-white/10">
                                      <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs debate-mono text-gray-400">
                                          {voteState.voteCount} / {voteState.requiredVotes} votes to kick
                                        </span>
                                      </div>
                                      <div className="w-full bg-gray-700 h-1.5 mb-2">
                                        <div
                                          className="bg-red-500 h-1.5 transition-all"
                                          style={{
                                            width: `${Math.min(100, voteState.requiredVotes > 0 ? (voteState.voteCount / voteState.requiredVotes) * 100 : 0)}%`,
                                          }}
                                        />
                                      </div>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className={`debate-button w-full text-xs ${
                                          voteState.userHasVoted ? 'border-red-500 text-red-400' : ''
                                        }`}
                                        onClick={async () => {
                                          try {
                                            if (voteState.userHasVoted) {
                                              await kickVoteChannel.removeVote(d.userId)
                                            } else {
                                              await kickVoteChannel.castVote(d.userId)
                                            }
                                            router.refresh()
                                          } catch (err) {
                                            console.error('Vote failed:', err)
                                          }
                                        }}
                                      >
                                        <ThumbsDown className="w-3 h-3 mr-1" />
                                        {voteState.userHasVoted ? 'REMOVE VOTE' : 'VOTE TO KICK'}
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        ) : debaters.length > 0 ? (
                          <div className="flex items-center justify-center gap-6 flex-wrap">
                            {debaters.map((p, i) => (
                              <div key={p.userId} className="flex items-center space-x-3 p-3 border-2 border-white/20">
                                <div
                                  className={`w-14 h-14 border-2 border-black flex items-center justify-center text-white font-bold text-lg ${
                                    i === 0
                                      ? 'bg-gradient-to-br from-red-600 to-red-800'
                                      : 'bg-gradient-to-br from-blue-600 to-blue-800'
                                  }`}
                                >
                                  {getInitials(displayName(p.user))}
                                </div>
                                <div>
                                  <h3 className="text-lg font-bold debate-title text-white">
                                    {displayName(p.user)}
                                  </h3>
                                  <span className="debate-badge bg-yellow-400 text-black text-xs">
                                    {p.sessionRole}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {/* Video feeds — only for debaters */}
                        {isDebater && (
                          <div className="space-y-3">
                            <div className="min-h-[250px]">
                              {connectionState === 'connecting' ? (
                                <div className="min-h-[250px] bg-gradient-to-br from-gray-900 to-gray-700 rounded-md border-2 border-black flex items-center justify-center">
                                  <div className="text-center">
                                    <Loader2 className="w-10 h-10 text-white/40 mx-auto mb-2 animate-spin" />
                                    <p className="text-white/40 debate-mono text-sm">CONNECTING TO VIDEO...</p>
                                  </div>
                                </div>
                              ) : connectionState === 'error' ? (
                                <div className="min-h-[250px] bg-gradient-to-br from-gray-900 to-gray-700 rounded-md border-2 border-red-600/50 flex items-center justify-center">
                                  <div className="text-center">
                                    <VideoOff className="w-10 h-10 text-red-400/60 mx-auto mb-2" />
                                    <p className="text-red-400/60 debate-mono text-sm">VIDEO CONNECTION FAILED</p>
                                  </div>
                                </div>
                              ) : connectionState === 'connected' ? (
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="min-h-[200px]">
                                    <VideoPanel stream={localStream} muted label="You" />
                                  </div>
                                  {Array.from(remoteStreams.entries())
                                    .filter(([, rs]) => rs.kind === 'video')
                                    .map(([id, rs]) => (
                                      <div key={id} className="min-h-[200px]">
                                        <VideoPanel stream={rs.stream} muted={false} label={rs.displayName} />
                                      </div>
                                    ))}
                                </div>
                              ) : (
                                <div className="min-h-[250px] bg-gradient-to-br from-gray-900 to-gray-700 rounded-md border-2 border-black flex items-center justify-center">
                                  <div className="text-center">
                                    <Volume2 className="w-16 h-16 text-white/20 mx-auto mb-2" />
                                    <p className="text-white/40 debate-mono text-sm">LIVE VIDEO FEED</p>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Audio/Video toggle controls */}
                            {connectionState === 'connected' && (
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="debate-button"
                                  onClick={toggleMute}
                                >
                                  {audioMuted ? <MicOff className="w-4 h-4 mr-1" /> : <Mic className="w-4 h-4 mr-1" />}
                                  {audioMuted ? 'UNMUTE' : 'MUTE'}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="debate-button"
                                  onClick={toggleVideo}
                                >
                                  {videoOff ? <VideoOff className="w-4 h-4 mr-1" /> : <Video className="w-4 h-4 mr-1" />}
                                  {videoOff ? 'CAM ON' : 'CAM OFF'}
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Speaker Queue */}
              <div>
                <Card className="debate-card border-2">
                  <CardHeader className="border-b-2 border-white/20">
                    <CardTitle className="debate-title flex items-center justify-between text-white">
                      <div className="flex items-center">
                        <Hand className="w-4 h-4 mr-2" />
                        SPEAKER QUEUE ({queueChannel.queue.length})
                      </div>
                      {queueChannel.queue.length > 0 && isExpertVsCrowd && (
                        <span className="text-xs debate-mono text-orange-400 font-normal">
                          NEXT UP: {queueChannel.queue[0]?.displayName}
                        </span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    {/* Queue actions for audience members */}
                    {isAudience && (
                      <div className="mb-4">
                        {queueChannel.isInQueue ? (
                          <div className="space-y-2">
                            <div className="text-center p-2 border-2 border-yellow-500/30 bg-yellow-500/5">
                              <p className="text-yellow-400 debate-mono text-sm font-bold">
                                You are #{queueChannel.myPosition} in queue
                              </p>
                            </div>
                            <Button
                              variant="outline"
                              className="debate-button w-full text-xs"
                              onClick={async () => {
                                try {
                                  await queueChannel.leaveQueue()
                                } catch (err) {
                                  console.error('Failed to leave queue:', err)
                                }
                              }}
                            >
                              LEAVE QUEUE
                            </Button>
                          </div>
                        ) : (
                          <Button
                            className="debate-button bg-yellow-500 text-black border-yellow-600 w-full font-bold"
                            onClick={async () => {
                              try {
                                await queueChannel.joinQueue()
                              } catch (err) {
                                console.error('Failed to join queue:', err)
                              }
                            }}
                          >
                            <Hand className="w-4 h-4 mr-2" />
                            {isExpertVsCrowd ? 'JOIN SPEAKER QUEUE' : 'JOIN QUEUE'}
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Moderator promote button */}
                    {isModeratorOrCreator && queueChannel.queue.length > 0 && (
                      <div className="mb-4">
                        <Button
                          variant="outline"
                          className="debate-button w-full text-xs"
                          onClick={async () => {
                            try {
                              await promoteFromQueue(session.id)
                              router.refresh()
                            } catch (err) {
                              console.error('Failed to promote:', err)
                            }
                          }}
                        >
                          <ArrowUp className="w-3 h-3 mr-1" />
                          PROMOTE NEXT: {queueChannel.queue[0]?.displayName}
                        </Button>
                      </div>
                    )}

                    {/* Queue list */}
                    {queueChannel.queue.length === 0 ? (
                      <p className="text-gray-500 debate-mono text-sm text-center py-2">Queue is empty</p>
                    ) : (
                      <div className="space-y-2">
                        {queueChannel.queue.map((entry) => (
                          <div
                            key={entry.id}
                            className={`flex items-center gap-3 p-2 border-2 ${
                              entry.userId === currentUserId
                                ? 'border-yellow-500/50 bg-yellow-500/5'
                                : 'border-white/10'
                            }`}
                          >
                            <span className="text-xs debate-mono text-gray-500 w-6 text-right">
                              #{entry.rank}
                            </span>
                            <div className="w-8 h-8 bg-gray-600 text-white font-bold text-xs flex items-center justify-center border border-black">
                              {getInitials(entry.displayName)}
                            </div>
                            <span className="text-sm debate-mono text-white truncate flex-1">
                              {entry.displayName}
                            </span>
                            {entry.rank === 1 && isExpertVsCrowd && (
                              <span className="debate-badge bg-orange-600 text-white text-[10px]">NEXT</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Audience (watching, not in queue) */}
              <div>
                <Card className="debate-card border-2">
                  <CardHeader className="border-b-2 border-white/20">
                    <CardTitle className="debate-title flex items-center text-white">
                      <Users className="w-4 h-4 mr-2" />
                      AUDIENCE ({audience.length} / {session.audienceCapacity})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    {/* Direct debater upgrade (non-Expert vs Crowd, non-queue path) */}
                    {canUpgradeToDebater && !isExpertVsCrowd && (
                      <div className="mb-4">
                        {session.type === SessionType.PANEL ? (
                          <Button
                            className="debate-button bg-yellow-500 text-black border-yellow-600 w-full font-bold"
                            onClick={() => handleUpgradeToDebater(false)}
                            disabled={isJoining}
                          >
                            <Swords className="w-4 h-4 mr-2" />
                            {isJoining ? 'JOINING...' : 'JOIN AS PANELIST'}
                          </Button>
                        ) : (
                          <div className="space-y-2">
                            {!showDebaterOptions ? (
                              <Button
                                className="debate-button bg-yellow-500 text-black border-yellow-600 w-full font-bold"
                                onClick={() => setShowDebaterOptions(true)}
                                disabled={isJoining}
                              >
                                <Swords className="w-4 h-4 mr-2" />
                                {isJoining ? 'JOINING...' : 'BECOME A DEBATER'}
                              </Button>
                            ) : (
                              <>
                                <div className="grid grid-cols-2 gap-2">
                                  <Button
                                    className="debate-button bg-red-600 text-white border-red-700 font-bold text-sm"
                                    onClick={() => handleUpgradeToDebater(true)}
                                    disabled={isJoining || proponentsFull}
                                  >
                                    {isJoining ? (
                                      <>
                                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                        JOINING...
                                      </>
                                    ) : proponentsFull ? (
                                      'PROPONENT FULL'
                                    ) : (
                                      'JOIN AS PROPONENT'
                                    )}
                                  </Button>
                                  <Button
                                    className="debate-button bg-blue-600 text-white border-blue-700 font-bold text-sm"
                                    onClick={() => handleUpgradeToDebater(false)}
                                    disabled={isJoining || opponentsFull}
                                  >
                                    {isJoining ? (
                                      <>
                                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                        JOINING...
                                      </>
                                    ) : opponentsFull ? (
                                      'OPPONENT FULL'
                                    ) : (
                                      'JOIN AS OPPONENT'
                                    )}
                                  </Button>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="debate-button w-full text-xs"
                                  onClick={() => setShowDebaterOptions(false)}
                                  disabled={isJoining}
                                >
                                  CANCEL
                                </Button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {audience.length === 0 ? (
                      <p className="text-gray-500 debate-mono text-sm text-center py-4">No audience members yet</p>
                    ) : (
                      <div className="grid grid-cols-4 gap-3">
                        {audience.map((person, index) => {
                          const queueEntry = queueChannel.queue.find((q) => q.userId === person.userId)
                          return (
                            <motion.div
                              key={person.userId}
                              initial={{ opacity: 0, y: 20 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: index * 0.05 }}
                              className={`text-center p-3 border-2 transition-colors ${
                                queueEntry
                                  ? 'border-yellow-500/40 bg-yellow-500/5'
                                  : 'border-white/20 hover:border-red-600'
                              }`}
                            >
                              <div className="w-12 h-12 bg-gray-600 text-white font-bold text-sm flex items-center justify-center mx-auto mb-2 border-2 border-black">
                                {getInitials(displayName(person.user))}
                              </div>
                              <p className="text-xs debate-mono font-medium truncate text-white">
                                {displayName(person.user)}
                              </p>
                              {queueEntry ? (
                                <p className="text-xs debate-mono text-yellow-400">Queue #{queueEntry.rank}</p>
                              ) : (
                                <p className="text-xs debate-mono text-gray-400">watching</p>
                              )}
                            </motion.div>
                          )
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Right Sidebar */}
            <div className="col-span-4 space-y-4">
              {/* Moderator Controls */}
              <Card className="debate-card border-2">
                <CardHeader className="border-b-2 border-white/20">
                  <CardTitle className="debate-title flex items-center text-white">
                    <Shield className="w-4 h-4 mr-2" />
                    MODERATOR
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="flex items-center space-x-3 mb-4">
                    <div className="w-10 h-10 bg-blue-600 text-white font-bold text-sm flex items-center justify-center border-2 border-black">
                      {getInitials(displayName(session.moderator ?? userStub))}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium debate-text text-white">{displayName(session.moderator ?? userStub)}</p>
                      <p className="text-xs debate-mono text-gray-400">
                        {session.status === SessionStatus.LIVE ? 'Active' : session.status}
                      </p>
                    </div>
                  </div>
                  {isModeratorOrCreator && session.status !== SessionStatus.WAITING && session.status !== SessionStatus.ENDED && (
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleTogglePause}
                        className="debate-button col-span-2"
                      >
                        {isPaused ? <Play className="w-4 h-4 mr-2" /> : <Pause className="w-4 h-4 mr-2" />}
                        {isPaused ? 'RESUME' : 'PAUSE'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="debate-button"
                        onClick={handleNextTurn}
                      >
                        <SkipForward className="w-4 h-4 mr-1" />
                        NEXT
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="debate-button"
                        onClick={handleEndSession}
                      >
                        END
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Live Transcript */}
              <Card className="debate-card border-2 flex-1">
                <CardHeader className="border-b-2 border-white/20">
                  <CardTitle className="debate-title flex items-center text-white">
                    <MessageSquare className="w-4 h-4 mr-2" />
                    LIVE TRANSCRIPT
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 h-64 overflow-y-auto">
                  <div className="h-full flex items-center justify-center">
                    <p className="text-gray-500 debate-mono text-sm">Transcript will appear here during the debate</p>
                  </div>
                </CardContent>
              </Card>

              {/* Participation */}
              <Card className="debate-card border-2">
                <CardHeader className="border-b-2 border-white/20">
                  <CardTitle className="debate-title flex items-center text-white">
                    <BarChart3 className="w-4 h-4 mr-2" />
                    PARTICIPANTS ({session.participatesIns.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="space-y-3">
                    {session.participatesIns.map((person) => (
                      <div key={person.userId} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${
                            person.sessionRole === SessionRole.HOST ? 'bg-yellow-400' :
                            person.sessionRole === SessionRole.MODERATOR ? 'bg-blue-400' :
                            person.sessionRole === SessionRole.DEBATER ? 'bg-red-400' : 'bg-gray-400'
                          }`} />
                          <span className="text-sm debate-mono truncate pr-2 text-white">
                            {displayName(person.user)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs debate-mono text-gray-400">
                            {person.sessionRole}
                          </span>
                          {isHost && person.userId !== currentUserId && person.sessionRole !== SessionRole.MODERATOR && (
                            <button
                              onClick={() => handleAssignModerator(person.userId)}
                              className="text-blue-400 hover:text-blue-300 text-xs opacity-60 hover:opacity-100"
                              title="Assign as moderator"
                            >
                              MOD
                            </button>
                          )}
                          {isModeratorOrCreator && person.userId !== currentUserId && (
                            <button
                              onClick={() => handleKick(person.userId)}
                              className="text-red-400 hover:text-red-300 text-xs ml-1 opacity-60 hover:opacity-100"
                              title="Kick participant"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}