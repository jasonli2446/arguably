'use client'

import { useState, useEffect } from 'react'
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
  LogIn,
  Loader2,
  Swords
} from 'lucide-react'
import { useMediasoup } from '@/hooks/useMediasoup'
import { useDebateState } from '@/hooks/useDebateState'
import VideoPanel from '@/components/VideoPanel'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getInitials, formatTime } from '@/lib/utils'
import { leaveSession, updateSessionStatus, joinSession, joinSessionAsDebater } from '@/lib/actions/session'
import { useRouter } from 'next/navigation'

interface Participant {
  participant_id: string
  role: string
  participant: {
    id: string
    username: string
    realname: string | null
  }
}

interface SessionData {
  id: string
  code: string
  name: string
  type: string
  status: string
  turn_length: number
  max_participants: number
  moderator: { id: string; username: string; realname: string | null }
  participatesIns: Participant[]
}

export default function RoomClient({
  session,
  currentUserId,
  currentRole,
  currentUsername,
}: {
  session: SessionData
  currentUserId: string | null
  currentRole: string | null
  currentUsername: string | null
}) {
  const router = useRouter()
  const [isJoining, setIsJoining] = useState(false)

  const isModeratorOrCreator = currentRole === 'MODERATOR' || currentRole === 'CREATOR'
  const isParticipant = currentRole !== null

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
    displayName: currentUsername ?? 'Anonymous',
    enabled: isParticipant,
  })

  const debate = useDebateState({
    sfuUrl: process.env.NEXT_PUBLIC_SFU_URL,
    roomId: session.code,
    userId: currentUserId,
    enabled: isParticipant,
  })

  // Refresh page when another participant joins/leaves
  useEffect(() => {
    return debate.onParticipantChanged(() => {
      router.refresh()
    })
  }, [debate.onParticipantChanged, router])

  const moderators = session.participatesIns.filter(
    (p) => p.role === 'MODERATOR' || p.role === 'CREATOR'
  )
  const sessionDebaters = session.participatesIns.filter(
    (p) => p.role === 'DEBATER' || p.role === 'CREATOR'
  )
  const audience = session.participatesIns.filter((p) => p.role === 'AUDIENCE')

  // Check if room can accept another debater (ONE_ON_ONE with < 2 debater-role participants)
  const canJoinAsDebater =
    session.type === 'ONE_ON_ONE' && sessionDebaters.length < 2

  // Use hook's timer when debate is active, otherwise show session turn_length
  const displayTime =
    debate.debateStatus === 'live' || debate.debateStatus === 'paused'
      ? debate.timeRemaining
      : session.turn_length
  const isPaused = debate.debateStatus === 'paused'

  async function handleLeave() {
    disconnectSfu()
    try {
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
      await updateSessionStatus(session.id, 'ENDED')
      router.push('/browse')
    } catch (err) {
      console.error('Failed to end session:', err)
    }
  }

  async function handleStartSession() {
    try {
      await updateSessionStatus(session.id, 'LIVE')

      // Build debater list from participants with CREATOR or DEBATER role
      const debaterList = sessionDebaters.map((p) => ({
        userId: p.participant.id,
        displayName: p.participant.realname || p.participant.username,
      }))

      if (debaterList.length === 2) {
        await debate.startDebate(debaterList, session.turn_length)
      }

      router.refresh()
    } catch (err) {
      console.error('Failed to start session:', err)
    }
  }

  async function handleJoin() {
    setIsJoining(true)
    try {
      await joinSession(session.id)
      debate.notifyParticipantChanged()
      router.refresh()
    } catch (err) {
      console.error('Failed to join:', err)
    } finally {
      setIsJoining(false)
    }
  }

  async function handleJoinAsDebater() {
    setIsJoining(true)
    try {
      await joinSessionAsDebater(session.id)
      debate.notifyParticipantChanged()
      router.refresh()
    } catch (err) {
      console.error('Failed to join as debater:', err)
    } finally {
      setIsJoining(false)
    }
  }

  async function handleNextTurn() {
    try {
      await debate.nextTurn()
    } catch (err) {
      console.error('Failed to advance turn:', err)
    }
  }

  const displayName = (p: { username: string; realname: string | null }) =>
    p.realname || p.username

  // Determine the status indicator and label
  const isDebateLive = debate.debateStatus === 'live' || debate.debateStatus === 'paused'
  const statusDot = isDebateLive ? 'bg-red-600 animate-pulse' : 'bg-gray-500'

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
                  session.status === 'LIVE'
                    ? 'bg-red-600'
                    : session.status === 'WAITING'
                    ? 'bg-yellow-500'
                    : session.status === 'PAUSED'
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
        {/* Join overlay for non-participants */}
        {!isParticipant && currentUserId && (
          <div className="absolute inset-0 z-20 bg-black/60 backdrop-blur-sm flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-gray-900 border-2 border-white/20 p-8 max-w-md text-center shadow-[8px_8px_0px_rgba(0,0,0,0.3)]"
            >
              <LogIn className="w-12 h-12 text-red-400 mx-auto mb-4" />
              <h2 className="text-2xl font-bold debate-title text-white mb-2">JOIN THIS DEBATE?</h2>
              <p className="text-gray-400 debate-text mb-6">
                {canJoinAsDebater
                  ? 'You can join as a debater or as an audience member.'
                  : "You'll join as an audience member. The moderator can promote you to debater."}
              </p>
              <div className="space-y-2">
                {canJoinAsDebater && (
                  <Button
                    className="debate-button bg-yellow-500 text-black border-yellow-600 w-full font-bold"
                    onClick={handleJoinAsDebater}
                    disabled={isJoining}
                  >
                    <Swords className="w-4 h-4 mr-2" />
                    {isJoining ? 'JOINING...' : 'JOIN AS DEBATER'}
                  </Button>
                )}
                <Button
                  className="debate-button bg-red-600 text-white border-red-700 w-full"
                  onClick={handleJoin}
                  disabled={isJoining}
                >
                  {isJoining ? 'JOINING...' : 'JOIN AS AUDIENCE'}
                </Button>
              </div>
            </motion.div>
          </div>
        )}

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
                        {session.status === 'WAITING'
                          ? 'WAITING TO START'
                          : debate.currentSpeaker
                          ? 'CURRENT SPEAKER'
                          : 'DEBATE STAGE'}
                      </CardTitle>
                      <div className="flex items-center space-x-2 text-white">
                        <Clock className="w-4 h-4" />
                        <span className="debate-mono font-bold">
                          {formatTime(displayTime)}
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-6">
                    {session.status === 'WAITING' ? (
                      <div className="flex flex-col items-center justify-center py-12">
                        <div className="text-center">
                          <Users className="w-16 h-16 text-white/20 mx-auto mb-4" />
                          <p className="text-2xl font-bold debate-title text-white mb-2">WAITING FOR PARTICIPANTS</p>
                          <p className="text-gray-400 debate-mono mb-2">
                            {session.participatesIns.length} / {session.max_participants} joined
                          </p>
                          {session.type === 'ONE_ON_ONE' && sessionDebaters.length < 2 && (
                            <p className="text-yellow-400 debate-mono text-sm mb-4">
                              Need {2 - sessionDebaters.length} more debater{sessionDebaters.length === 0 ? 's' : ''} to start
                            </p>
                          )}
                          {isModeratorOrCreator && (
                            <Button
                              className="debate-button bg-red-600 text-white border-red-700"
                              onClick={handleStartSession}
                              disabled={session.type === 'ONE_ON_ONE' && sessionDebaters.length < 2}
                            >
                              START DEBATE
                            </Button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col space-y-4">
                        {/* Debater display: show both debaters side-by-side */}
                        {isDebateLive && debate.debaters.length === 2 ? (
                          <div className="flex items-center justify-center gap-6">
                            {debate.debaters.map((d, i) => {
                              const isSpeaking = debate.currentSpeaker?.userId === d.userId
                              return (
                                <div
                                  key={d.userId}
                                  className={`flex items-center space-x-3 p-3 border-2 transition-all ${
                                    isSpeaking
                                      ? 'border-yellow-400 bg-yellow-400/10 shadow-[0_0_15px_rgba(250,204,21,0.3)]'
                                      : 'border-white/20 opacity-60'
                                  }`}
                                >
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
                                    <h3 className="text-lg font-bold debate-title text-white">
                                      {d.displayName}
                                    </h3>
                                    {isSpeaking && (
                                      <span className="debate-badge bg-yellow-400 text-black text-xs">
                                        SPEAKING
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        ) : sessionDebaters.length > 0 ? (
                          <div className="flex items-center space-x-4">
                            <div className="w-16 h-16 bg-gradient-to-br from-red-600 to-red-800 border-2 border-black flex items-center justify-center text-white font-bold text-xl">
                              {getInitials(displayName(sessionDebaters[0].participant))}
                            </div>
                            <div>
                              <h3 className="text-xl font-bold debate-title text-white">
                                {displayName(sessionDebaters[0].participant)}
                              </h3>
                              <span className="debate-badge bg-yellow-400 text-black text-xs">
                                {sessionDebaters[0].role}
                              </span>
                            </div>
                          </div>
                        ) : null}

                        {/* Video feeds */}
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
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Audience Queue */}
              <div>
                <Card className="debate-card border-2">
                  <CardHeader className="border-b-2 border-white/20">
                    <CardTitle className="debate-title flex items-center text-white">
                      <Users className="w-4 h-4 mr-2" />
                      AUDIENCE QUEUE ({audience.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    {audience.length === 0 ? (
                      <p className="text-gray-500 debate-mono text-sm text-center py-4">No audience members yet</p>
                    ) : (
                      <div className="grid grid-cols-4 gap-3">
                        {audience.map((person, index) => (
                          <motion.div
                            key={person.participant_id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.1 }}
                            className="text-center p-3 border-2 border-white/20 hover:border-red-600 transition-colors cursor-pointer"
                          >
                            <div className="w-12 h-12 bg-gray-600 text-white font-bold text-sm flex items-center justify-center mx-auto mb-2 border-2 border-black">
                              {getInitials(displayName(person.participant))}
                            </div>
                            <p className="text-xs debate-mono font-medium truncate text-white">
                              {displayName(person.participant)}
                            </p>
                            <p className="text-xs debate-mono text-gray-400">#{index + 1}</p>
                          </motion.div>
                        ))}
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
                      {getInitials(displayName(session.moderator))}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium debate-text text-white">{displayName(session.moderator)}</p>
                      <p className="text-xs debate-mono text-gray-400">
                        {session.status === 'LIVE' ? 'Active' : session.status}
                      </p>
                    </div>
                  </div>
                  {isModeratorOrCreator && session.status !== 'WAITING' && session.status !== 'ENDED' && (
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

              {/* Live Transcript placeholder */}
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
                      <div key={person.participant_id} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${
                            person.role === 'CREATOR' ? 'bg-yellow-400' :
                            person.role === 'MODERATOR' ? 'bg-blue-400' :
                            person.role === 'DEBATER' ? 'bg-red-400' : 'bg-gray-400'
                          }`} />
                          <span className="text-sm debate-mono truncate pr-2 text-white">
                            {displayName(person.participant)}
                          </span>
                        </div>
                        <span className="text-xs debate-mono text-gray-400">
                          {person.role}
                        </span>
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
