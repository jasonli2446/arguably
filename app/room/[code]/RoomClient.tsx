'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
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
  Settings,
  LogIn
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getInitials, formatTime } from '@/lib/utils'
import { leaveSession, updateSessionStatus, joinSession } from '@/lib/actions/session'
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
}: {
  session: SessionData
  currentUserId: string | null
  currentRole: string | null
}) {
  const router = useRouter()
  const [isPaused, setIsPaused] = useState(session.status === 'PAUSED')
  const [timeRemaining, setTimeRemaining] = useState(session.turn_length)
  const [isJoining, setIsJoining] = useState(false)

  const isModeratorOrCreator = currentRole === 'MODERATOR' || currentRole === 'CREATOR'
  const isParticipant = currentRole !== null

  const moderators = session.participatesIns.filter(
    (p) => p.role === 'MODERATOR' || p.role === 'CREATOR'
  )
  const debaters = session.participatesIns.filter((p) => p.role === 'DEBATER')
  const audience = session.participatesIns.filter((p) => p.role === 'AUDIENCE')

  // Timer countdown
  useEffect(() => {
    if (!isPaused && session.status === 'LIVE') {
      const interval = setInterval(() => {
        setTimeRemaining((prev) => (prev > 0 ? prev - 1 : 0))
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [isPaused, session.status])

  async function handleLeave() {
    try {
      await leaveSession(session.id)
      router.push('/browse')
    } catch (err) {
      console.error('Failed to leave:', err)
      router.push('/browse')
    }
  }

  async function handleTogglePause() {
    const newStatus = isPaused ? 'LIVE' : 'PAUSED'
    try {
      await updateSessionStatus(session.id, newStatus)
      setIsPaused(!isPaused)
    } catch (err) {
      console.error('Failed to update status:', err)
    }
  }

  async function handleEndSession() {
    try {
      await updateSessionStatus(session.id, 'ENDED')
      router.push('/browse')
    } catch (err) {
      console.error('Failed to end session:', err)
    }
  }

  async function handleStartSession() {
    try {
      await updateSessionStatus(session.id, 'LIVE')
      router.refresh()
    } catch (err) {
      console.error('Failed to start session:', err)
    }
  }

  async function handleJoin() {
    setIsJoining(true)
    try {
      await joinSession(session.id)
      router.refresh()
    } catch (err) {
      console.error('Failed to join:', err)
    } finally {
      setIsJoining(false)
    }
  }

  const displayName = (p: { username: string; realname: string | null }) =>
    p.realname || p.username

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
                You&apos;ll join as an audience member. The moderator can promote you to debater.
              </p>
              <Button
                className="debate-button bg-red-600 text-white border-red-700 w-full"
                onClick={handleJoin}
                disabled={isJoining}
              >
                {isJoining ? 'JOINING...' : 'JOIN AS AUDIENCE'}
              </Button>
            </motion.div>
          </div>
        )}

        <div className="container mx-auto px-6 py-4">
          <div className="grid grid-cols-12 gap-4">
            {/* Main Stage */}
            <div className="col-span-8 space-y-4">
              <div className="min-h-[400px]">
                <Card className="debate-card border-2">
                  <CardHeader className="border-b-2 border-white/20">
                    <div className="flex items-center justify-between">
                      <CardTitle className="debate-title flex items-center text-white">
                        <div className={`w-3 h-3 rounded-full mr-3 ${session.status === 'LIVE' ? 'bg-red-600 animate-pulse' : 'bg-gray-500'}`} />
                        {session.status === 'WAITING' ? 'WAITING TO START' : 'CURRENT SPEAKER'}
                      </CardTitle>
                      <div className="flex items-center space-x-2 text-white">
                        <Clock className="w-4 h-4" />
                        <span className="debate-mono font-bold">
                          {formatTime(timeRemaining)}
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
                          <p className="text-gray-400 debate-mono mb-6">
                            {session.participatesIns.length} / {session.max_participants} joined
                          </p>
                          {isModeratorOrCreator && (
                            <Button
                              className="debate-button bg-red-600 text-white border-red-700"
                              onClick={handleStartSession}
                            >
                              START DEBATE
                            </Button>
                          )}
                        </div>
                      </div>
                    ) : debaters.length > 0 ? (
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={debaters[0].participant_id}
                          initial={{ opacity: 0, x: 50 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -50 }}
                          className="flex flex-col"
                        >
                          <div className="flex items-center space-x-4 mb-6">
                            <div className="w-16 h-16 bg-gradient-to-br from-red-600 to-red-800 border-2 border-black flex items-center justify-center text-white font-bold text-xl">
                              {getInitials(displayName(debaters[0].participant))}
                            </div>
                            <div>
                              <h3 className="text-xl font-bold debate-title text-white">
                                {displayName(debaters[0].participant)}
                              </h3>
                              <span className="debate-badge bg-yellow-400 text-black text-xs">
                                {debaters[0].role}
                              </span>
                            </div>
                          </div>

                          <div className="min-h-[250px] bg-gradient-to-br from-gray-900 to-gray-700 rounded-md border-2 border-black relative overflow-hidden">
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="text-center">
                                <Volume2 className="w-16 h-16 text-white/20 mx-auto mb-2" />
                                <p className="text-white/40 debate-mono text-sm">LIVE VIDEO FEED</p>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      </AnimatePresence>
                    ) : (
                      <div className="flex items-center justify-center py-12">
                        <div className="text-center">
                          <Mic className="w-16 h-16 text-white/20 mx-auto mb-4" />
                          <p className="text-gray-400 debate-mono">No active debaters yet</p>
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
                      <Button variant="outline" size="sm" className="debate-button">
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
