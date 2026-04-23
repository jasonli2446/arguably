'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
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
  Timer,
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
  RefreshCw,
  Sparkles,
  ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'
import { useMediasoup } from '@/hooks/useMediasoup'
import { useLiveTranscript } from '@/hooks/useLiveTranscript'
import { useLiveClaims } from '@/hooks/useLiveClaims'
import type { TranscriptSegmentView } from '@/lib/transcripts'
import type { ClaimView } from '@/lib/claims'
import { useDebateChannel } from '@/hooks/useDebateChannel'
import { useQueueChannel } from '@/hooks/useQueueChannel'
import { useKickVoteChannel } from '@/hooks/useKickVoteChannel'
import { createClient } from '@/lib/supabase/client'
import VideoPanel from '@/components/VideoPanel'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { userStub, getInitials, formatTime } from '@/lib/utils'
import { leaveSession, updateSessionStatus, joinSession, joinSessionAsDebater, kickParticipant, assignModerator, promoteToDebater } from '@/lib/actions/session'
import { promoteFromQueue } from '@/lib/actions/queue'
import { extendTurn } from '@/lib/actions/debate'
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
  transcriptSegments: TranscriptSegmentView[]
  detectedClaims: ClaimView[]
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
  const [isJoining, setIsJoining] = useState(false)
  const [showDebaterOptions, setShowDebaterOptions] = useState(false)

  // Loading states for async operations
  const [isStarting, setIsStarting] = useState(false)
  const [isPauseToggling, setIsPauseToggling] = useState(false)
  const [isEnding, setIsEnding] = useState(false)
  const [isAdvancingTurn, setIsAdvancingTurn] = useState(false)
  const [isExtendingTurn, setIsExtendingTurn] = useState(false)
  const [isAssigningModerator, setIsAssigningModerator] = useState<string | null>(null)
  const [isKicking, setIsKicking] = useState<string | null>(null)
  const [isPromoting, setIsPromoting] = useState<string | null>(null)

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'kick' | 'end' | 'moderator' | 'promote'
    targetUserId?: string
    targetName?: string
  } | null>(null)

  const isModeratorOrCreator = currentRole === SessionRole.MODERATOR || currentRole === SessionRole.HOST
  const isHost = currentRole === SessionRole.HOST
  const isParticipant = session.participatesIns.some(p => p.userId === currentUserId)
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
    reconnect: reconnectSfu,
  } = useMediasoup({
    sfuUrl: process.env.NEXT_PUBLIC_SFU_URL,
    roomId: session.code,
    displayName: currentUsername,
    enabled: isDebater,
  })

  const debate = useDebateChannel({
    sfuUrl: process.env.NEXT_PUBLIC_SFU_URL,
    roomCode: session.code,
    userId: currentUserId,
    onParticipantKicked: () => router.refresh(),
    onParticipantPromoted: () => router.refresh(),
    onParticipantMuted: () => router.refresh(),
  })

  const transcript = useLiveTranscript({
    sessionId: session.id,
    currentUserId,
    localStream,
    enabled: isDebater && session.status !== SessionStatus.ENDED,
    audioMuted,
    initialSegments: session.transcriptSegments,
  })

  const transcriptEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript.segments])

  const { claims } = useLiveClaims({
    sessionId: session.id,
    initialClaims: session.detectedClaims,
  })

  const claimsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    claimsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [claims])

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

  // Derive isPaused from debate channel (authoritative source via Supabase Realtime)
  const isPaused = debate.isPaused || session.status === SessionStatus.PAUSED

  // Toast on video connection error
  const prevConnectionState = useRef(connectionState)
  useEffect(() => {
    if (prevConnectionState.current !== 'error' && connectionState === 'error') {
      toast.error('Video connection failed')
    }
    prevConnectionState.current = connectionState
  }, [connectionState])

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
        toast.error('Failed to join room automatically')
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

  // --- Handlers with toast + loading ---

  async function handleLeave() {
    disconnectSfu()
    try {
      if (queueChannel.isInQueue) {
        await queueChannel.leaveQueue()
      }
      await leaveSession(session.id)
    } catch (err) {
      console.error('Failed to leave:', err)
      toast.error('Failed to leave session')
    }
    router.push('/browse')
  }

  async function handleTogglePause() {
    setIsPauseToggling(true)
    try {
      if (isPaused) {
        await debate.resume()
        await updateSessionStatus(session.id, 'LIVE')
        toast.success('Debate resumed')
      } else {
        await debate.pause()
        await updateSessionStatus(session.id, 'PAUSED')
        toast.success('Debate paused')
      }
    } catch (err) {
      console.error('Failed to toggle pause:', err)
      toast.error('Failed to toggle pause')
    } finally {
      setIsPauseToggling(false)
    }
  }

  async function handleEndSession() {
    setIsEnding(true)
    try {
      await debate.endDebate()
      await updateSessionStatus(session.id, SessionStatus.ENDED)
      toast.success('Session ended')
      router.push(`/room/${session.code}/replay`)
    } catch (err) {
      console.error('Failed to end session:', err)
      toast.error('Failed to end session')
    } finally {
      setIsEnding(false)
    }
  }

  async function handleStartSession() {
    setIsStarting(true)
    try {
      // Build debater list from participants with HOST or DEBATER role
      const debaterList = debaters.map((p) => ({
        userId: p.user.id,
        displayName: p.user.realname || p.user.username,
      }))

      if (isExpertVsCrowd) {
        // Expert vs Crowd: pass only the expert (host), backend auto-promotes from queue
        const expert = debaterList.find((d) => d.userId === session.host.id) ?? debaterList[0]
        await debate.startDebate([expert], session.turnLength, session.type)
      } else if (debaterList.length >= 2) {
        await debate.startDebate(debaterList, session.turnLength, session.type)
      }

      await updateSessionStatus(session.id, SessionStatus.LIVE)
      toast.success('Debate started')
      router.refresh()
    } catch (err) {
      console.error('Failed to start session:', err)
      toast.error('Failed to start debate')
    } finally {
      setIsStarting(false)
    }
  }

  async function handleUpgradeToDebater(isProponent: boolean) {
    setIsJoining(true)
    try {
      await joinSessionAsDebater(session.id, isProponent)
      toast.success('Joined as debater')
      router.refresh()
    } catch (err) {
      console.error('Failed to upgrade to debater:', err)
      toast.error('Failed to join as debater')
    } finally {
      setIsJoining(false)
      setShowDebaterOptions(false)
    }
  }

  async function handleAssignModerator(userId: string) {
    setIsAssigningModerator(userId)
    try {
      await assignModerator(session.id, userId)
      toast.success('Moderator assigned')
      router.refresh()
    } catch (err) {
      console.error('Failed to assign moderator:', err)
      toast.error('Failed to assign moderator')
    } finally {
      setIsAssigningModerator(null)
    }
  }

  async function handleNextTurn() {
    setIsAdvancingTurn(true)
    try {
      await debate.nextTurn()
      toast.success('Turn advanced')
    } catch (err) {
      console.error('Failed to advance turn:', err)
      toast.error('Failed to advance turn')
    } finally {
      setIsAdvancingTurn(false)
    }
  }

  async function handleExtendTurn() {
    setIsExtendingTurn(true)
    try {
      await extendTurn(session.id, 30)
      toast.success('Turn extended by 30s')
    } catch (err) {
      console.error('Failed to extend turn:', err)
      toast.error('Failed to extend turn')
    } finally {
      setIsExtendingTurn(false)
    }
  }

  async function handleKick(userId: string) {
    setIsKicking(userId)
    try {
      await kickParticipant(session.id, userId)
      toast.success('Participant removed')
      await debate.broadcastKick(userId).catch(() => {})
      router.refresh()
    } catch (err) {
      console.error('Failed to kick participant:', err)
      toast.error('Failed to remove participant')
    } finally {
      setIsKicking(null)
    }
  }

  async function handlePromote(userId: string) {
    setIsPromoting(userId)
    try {
      await promoteToDebater(session.id, userId)
      toast.success('Participant promoted to debater')
      await debate.broadcastPromote(userId).catch(() => {})
      router.refresh()
    } catch (err) {
      console.error('Failed to promote participant:', err)
      toast.error('Failed to promote participant')
    } finally {
      setIsPromoting(null)
    }
  }

  async function handleMute(userId: string) {
    try {
      await debate.broadcastMute(userId)
      toast.success('Participant muted')
    } catch (err) {
      console.error('Failed to mute participant:', err)
      toast.error('Failed to mute participant')
    }
  }

  // Confirmation dialog handler
  async function handleConfirmAction() {
    if (!confirmDialog) return
    const { type, targetUserId } = confirmDialog
    setConfirmDialog(null)

    switch (type) {
      case 'kick':
        if (targetUserId) await handleKick(targetUserId)
        break
      case 'end':
        await handleEndSession()
        break
      case 'moderator':
        if (targetUserId) await handleAssignModerator(targetUserId)
        break
      case 'promote':
        if (targetUserId) await handlePromote(targetUserId)
        break
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

  const transcriptStatusMessage = transcript.error
    ? transcript.error
    : transcript.isCapturing
    ? 'Mic transcription is live'
    : isDebater
    ? audioMuted ? 'Unmute to start live transcription' : 'Waiting for microphone access'
    : 'Join as a debater to generate transcript'

  // Confirm dialog config
  const confirmDialogConfig = confirmDialog ? {
    kick: {
      title: 'KICK PARTICIPANT',
      description: `Remove ${confirmDialog.targetName} from this session? They can rejoin if the room is still open.`,
      confirmLabel: 'KICK',
      variant: 'destructive' as const,
    },
    end: {
      title: 'END SESSION',
      description: 'End the debate for all participants? This action cannot be undone.',
      confirmLabel: 'END SESSION',
      variant: 'destructive' as const,
    },
    moderator: {
      title: 'ASSIGN MODERATOR',
      description: `Promote ${confirmDialog.targetName} to moderator? The current moderator will be demoted to audience.`,
      confirmLabel: 'PROMOTE',
      variant: 'default' as const,
    },
    promote: {
      title: 'PROMOTE TO DEBATER',
      description: `Promote ${confirmDialog.targetName} from audience to debater?`,
      confirmLabel: 'PROMOTE',
      variant: 'default' as const,
    },
  }[confirmDialog.type] : null

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
                              disabled={!canStartDebate || isStarting}
                            >
                              {isStarting ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  STARTING...
                                </>
                              ) : (
                                'START DEBATE'
                              )}
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
                                    <p className="text-red-400/60 debate-mono text-sm mb-3">VIDEO CONNECTION FAILED</p>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="debate-button"
                                      onClick={reconnectSfu}
                                    >
                                      <RefreshCw className="w-4 h-4 mr-2" />
                                      RETRY CONNECTION
                                    </Button>
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
                            disabled={session.status !== SessionStatus.LIVE}
                            onClick={async () => {
                              if (session.status !== SessionStatus.LIVE) return
                              try {
                                await queueChannel.joinQueue()
                              } catch (err) {
                                console.error('Failed to join queue:', err)
                              }
                            }}
                          >
                            <Hand className="w-4 h-4 mr-2" />
                            {isExpertVsCrowd ? 'JOIN SPEAKER QUEUE' : 'JOIN QUEUE'}
                            {session.status !== SessionStatus.LIVE && (
                              <span className="ml-1 text-xs opacity-70">(opens when live)</span>
                            )}
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
                        disabled={isPauseToggling}
                      >
                        {isPauseToggling ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : isPaused ? (
                          <Play className="w-4 h-4 mr-2" />
                        ) : (
                          <Pause className="w-4 h-4 mr-2" />
                        )}
                        {isPaused ? 'RESUME' : 'PAUSE'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="debate-button"
                        onClick={handleNextTurn}
                        disabled={isAdvancingTurn}
                      >
                        {isAdvancingTurn ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <SkipForward className="w-4 h-4 mr-1" />
                        )}
                        NEXT
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="debate-button"
                        onClick={handleExtendTurn}
                        disabled={isExtendingTurn}
                      >
                        {isExtendingTurn ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <Timer className="w-4 h-4 mr-1" />
                        )}
                        +30s
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="debate-button col-span-2"
                        onClick={() => setConfirmDialog({ type: 'end' })}
                        disabled={isEnding}
                      >
                        {isEnding ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : null}
                        END
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Live Transcript */}
              <Card className="debate-card border-2 flex-1">
                <CardHeader className="border-b-2 border-white/20">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="debate-title flex items-center text-white">
                      <MessageSquare className="w-4 h-4 mr-2" />
                      LIVE TRANSCRIPT
                    </CardTitle>
                    <span
                      className={`debate-mono text-[10px] uppercase ${
                        transcript.error
                          ? 'text-red-400'
                          : transcript.isCapturing
                          ? 'text-green-400'
                          : 'text-gray-400'
                      }`}
                    >
                      {transcript.error ? 'Issue' : transcript.isCapturing ? 'Listening' : 'Idle'}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="p-4 h-64 overflow-y-auto">
                  {transcript.segments.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center">
                      <p className="text-gray-500 debate-mono text-sm">{transcriptStatusMessage}</p>
                      <p className="text-gray-600 debate-mono text-xs mt-2">
                        Transcript segments post every few seconds while a debater microphone is active.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {transcript.segments.map((segment) => (
                        <div
                          key={segment.id}
                          className="border-l-2 border-red-500/60 pl-3"
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="debate-mono text-xs text-red-300 uppercase truncate">
                              {segment.speakerName}
                            </span>
                            <span className="debate-mono text-[10px] text-gray-500 shrink-0">
                              {new Date(segment.startedAt).toLocaleTimeString([], {
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <p className="text-sm leading-relaxed text-white">
                            {segment.text}
                          </p>
                        </div>
                      ))}
                      <div ref={transcriptEndRef} />
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* AI Claim Detection */}
              <Card className="debate-card border-2 flex-1">
                <CardHeader className="border-b-2 border-white/20">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="debate-title flex items-center text-white">
                      <Sparkles className="w-4 h-4 mr-2" />
                      AI CLAIM DETECTION
                    </CardTitle>
                    <span className="debate-mono text-[10px] uppercase text-purple-400">
                      AI-SUGGESTED
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="p-4 h-64 overflow-y-auto">
                  {claims.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center">
                      <p className="text-gray-500 debate-mono text-sm">No claims detected yet</p>
                      <p className="text-gray-600 debate-mono text-xs mt-2">
                        Factual claims will be analyzed as debaters speak.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {claims.map((claim) => (
                        <div
                          key={claim.id}
                          className="border-l-2 border-purple-500/60 pl-3"
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="debate-mono text-xs text-purple-300 uppercase truncate">
                              {claim.speakerName}
                            </span>
                            <span className="debate-mono text-[10px] text-gray-500 shrink-0">
                              {Math.round(claim.confidence * 100)}%
                            </span>
                          </div>
                          <p className="text-sm text-white/80 italic mb-1">
                            &ldquo;{claim.claimText}&rdquo;
                          </p>
                          <p className="text-xs text-gray-400 mb-1">
                            {claim.analysis}
                          </p>
                          {claim.sources.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {claim.sources.map((source, i) => (
                                <a
                                  key={i}
                                  href={source.url}
                                  target="_blank"
                                  rel="noopener noreferrer nofollow"
                                  className="inline-flex items-center gap-1 text-[10px] text-purple-400 hover:text-purple-300 debate-mono"
                                  title={source.description}
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  {source.title}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                      <div ref={claimsEndRef} />
                    </div>
                  )}
                </CardContent>
                <div className="px-4 pb-2">
                  <p className="text-[10px] text-gray-600 debate-mono text-center">
                    Sources are AI-generated and may not be accurate
                  </p>
                </div>
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
                        <div className="flex items-center gap-1">
                          <span className="text-xs debate-mono text-gray-400">
                            {person.sessionRole}
                          </span>
                          {/* Promote audience to debater (WAITING only) */}
                          {isModeratorOrCreator && person.userId !== currentUserId && person.sessionRole === SessionRole.AUDIENCE && session.status === SessionStatus.WAITING && canJoinAsDebater && (
                            <button
                              onClick={() => setConfirmDialog({ type: 'promote', targetUserId: person.userId, targetName: displayName(person.user) })}
                              className="text-green-400 hover:text-green-300 text-xs opacity-60 hover:opacity-100"
                              title="Promote to debater"
                              disabled={isPromoting === person.userId}
                            >
                              {isPromoting === person.userId ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <ArrowUp className="w-3 h-3" />
                              )}
                            </button>
                          )}
                          {/* Mute debater via SFU pauseProducer */}
                          {isModeratorOrCreator && person.userId !== currentUserId && (person.sessionRole === SessionRole.DEBATER || person.sessionRole === SessionRole.HOST) && session.status !== SessionStatus.WAITING && (
                            <button
                              onClick={() => handleMute(person.userId)}
                              className="text-yellow-400 hover:text-yellow-300 text-xs opacity-60 hover:opacity-100"
                              title="Mute participant"
                            >
                              <MicOff className="w-3 h-3" />
                            </button>
                          )}
                          {/* Assign moderator */}
                          {isHost && person.userId !== currentUserId && person.sessionRole !== SessionRole.MODERATOR && (
                            <button
                              onClick={() => setConfirmDialog({ type: 'moderator', targetUserId: person.userId, targetName: displayName(person.user) })}
                              className="text-blue-400 hover:text-blue-300 text-xs opacity-60 hover:opacity-100"
                              title="Assign as moderator"
                              disabled={isAssigningModerator === person.userId}
                            >
                              {isAssigningModerator === person.userId ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                'MOD'
                              )}
                            </button>
                          )}
                          {/* Kick participant */}
                          {isModeratorOrCreator && person.userId !== currentUserId && (
                            <button
                              onClick={() => setConfirmDialog({ type: 'kick', targetUserId: person.userId, targetName: displayName(person.user) })}
                              className="text-red-400 hover:text-red-300 text-xs ml-1 opacity-60 hover:opacity-100"
                              title="Kick participant"
                              disabled={isKicking === person.userId}
                            >
                              {isKicking === person.userId ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                '✕'
                              )}
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

      {/* Confirmation Dialog */}
      {confirmDialogConfig && (
        <ConfirmDialog
          open={confirmDialog !== null}
          onOpenChange={(open) => { if (!open) setConfirmDialog(null) }}
          title={confirmDialogConfig.title}
          description={confirmDialogConfig.description}
          confirmLabel={confirmDialogConfig.confirmLabel}
          variant={confirmDialogConfig.variant}
          loading={isEnding || isKicking !== null || isAssigningModerator !== null || isPromoting !== null}
          onConfirm={handleConfirmAction}
        />
      )}
    </div>
  )
}
