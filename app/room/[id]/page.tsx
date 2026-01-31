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
  Settings
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getInitials, formatTime } from '@/lib/utils'

interface Participant {
  id: string
  name: string
  role: 'expert' | 'challenger' | 'moderator' | 'audience'
  isSpeaking: boolean
  isMuted: boolean
  timeRemaining: number
  totalSpeakingTime: number
}

interface Message {
  id: string
  participant: string
  content: string
  timestamp: Date
  type: 'claim' | 'statement' | 'question'
}

export default function DebateRoom() {
  const [isPaused, setIsPaused] = useState(false)
  const [currentSpeaker, setCurrentSpeaker] = useState<string>('expert-1')
  const [speakers, setSpeakers] = useState<Participant[]>([
    {
      id: 'expert-1',
      name: 'Dr. Sarah Chen',
      role: 'expert',
      isSpeaking: true,
      isMuted: false,
      timeRemaining: 120,
      totalSpeakingTime: 180
    },
    {
      id: 'moderator-1',
      name: 'Alex Thompson',
      role: 'moderator',
      isSpeaking: false,
      isMuted: false,
      timeRemaining: 0,
      totalSpeakingTime: 45
    }
  ])
  
  const [audience, setAudience] = useState<Participant[]>([
    { id: 'aud-1', name: 'Marcus Johnson', role: 'audience', isSpeaking: false, isMuted: false, timeRemaining: 0, totalSpeakingTime: 0 },
    { id: 'aud-2', name: 'Elena Rodriguez', role: 'audience', isSpeaking: false, isMuted: false, timeRemaining: 0, totalSpeakingTime: 0 },
    { id: 'aud-3', name: 'David Kim', role: 'audience', isSpeaking: false, isMuted: false, timeRemaining: 0, totalSpeakingTime: 0 },
    { id: 'aud-4', name: 'Sophia Patel', role: 'audience', isSpeaking: false, isMuted: false, timeRemaining: 0, totalSpeakingTime: 0 }
  ])

  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      participant: 'Dr. Sarah Chen',
      content: 'The fundamental issue with current climate policy is the disconnect between economic incentives and environmental goals.',
      timestamp: new Date(),
      type: 'statement'
    },
    {
      id: '2',
      participant: 'Dr. Sarah Chen',
      content: 'According to the IPCC 2023 report, carbon pricing mechanisms reduce emissions by 15-30% in participating economies.',
      timestamp: new Date(),
      type: 'claim'
    }
  ])

  useEffect(() => {
    if (!isPaused) {
      const interval = setInterval(() => {
        setSpeakers(prev => prev.map(speaker => {
          if (speaker.isSpeaking && speaker.timeRemaining > 0) {
            return { ...speaker, timeRemaining: speaker.timeRemaining - 1 }
          }
          return speaker
        }))
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [isPaused])

  const currentSpeakerData = speakers.find(s => s.isSpeaking)
  const moderator = speakers.find(s => s.role === 'moderator')

  const toggleMute = (participantId: string) => {
    setSpeakers(prev => prev.map(s => 
      s.id === participantId ? { ...s, isMuted: !s.isMuted } : s
    ))
  }

  const nextSpeaker = () => {
    if (audience.length > 0) {
      const nextAudience = audience[0]
      setSpeakers(prev => prev.map(s => ({ ...s, isSpeaking: false })))
      setAudience(prev => prev.slice(1))
      setSpeakers(prev => [...prev, { ...nextAudience, role: 'challenger', isSpeaking: true, timeRemaining: 120 }])
    }
  }

  return (
    <div className="min-h-screen debate-container">
      <div className="debate-grid fixed inset-0 opacity-30" />
      
      <header className="relative z-10 border-b-2 border-border bg-background/80 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h1 className="text-xl font-bold debate-title">ARG-2478</h1>
              <span className="debate-badge bg-red-600 text-white">LIVE</span>
              <span className="debate-mono text-sm text-muted-foreground">
                Climate Policy: Economic Realities vs Environmental Goals
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <Button variant="ghost" size="sm" className="debate-button">
                <Settings className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" className="debate-button">
                EXIT ROOM
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 h-[calc(100vh-60px)]">
        <div className="container mx-auto px-6 py-4 h-full">
          <div className="grid grid-cols-12 gap-4 h-full">
            
            {/* Main Stage - Speaker Area */}
            <div className="col-span-8 space-y-4">
              <div className="h-2/3">
                <Card className="h-full debate-card border-2">
                  <CardHeader className="border-b-2 border-border">
                    <div className="flex items-center justify-between">
                      <CardTitle className="debate-title flex items-center">
                        <div className="w-3 h-3 bg-red-600 rounded-full mr-3 animate-pulse" />
                        CURRENT SPEAKER
                      </CardTitle>
                      <div className="flex items-center space-x-2">
                        <Clock className="w-4 h-4" />
                        <span className="debate-mono font-bold">
                          {currentSpeakerData ? formatTime(currentSpeakerData.timeRemaining) : '00:00'}
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-6 h-full">
                    <AnimatePresence mode="wait">
                      {currentSpeakerData && (
                        <motion.div
                          key={currentSpeakerData.id}
                          initial={{ opacity: 0, x: 50 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -50 }}
                          className="h-full flex flex-col"
                        >
                          <div className="flex items-center space-x-4 mb-6">
                            <div className="w-16 h-16 bg-gradient-to-br from-red-600 to-red-800 border-2 border-black flex items-center justify-center text-white font-bold text-xl">
                              {getInitials(currentSpeakerData.name)}
                            </div>
                            <div>
                              <h3 className="text-xl font-bold debate-title">{currentSpeakerData.name}</h3>
                              <span className="debate-badge bg-yellow-400 text-black text-xs">
                                {currentSpeakerData.role.toUpperCase()}
                              </span>
                            </div>
                            <div className="ml-auto">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => toggleMute(currentSpeakerData.id)}
                                className={`debate-button ${currentSpeakerData.isMuted ? 'bg-red-100' : ''}`}
                              >
                                {currentSpeakerData.isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                              </Button>
                            </div>
                          </div>

                          {/* Simulated video area */}
                          <div className="flex-1 bg-gradient-to-br from-gray-900 to-gray-700 rounded-md border-2 border-black relative overflow-hidden">
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="text-center">
                                <Volume2 className="w-16 h-16 text-white/20 mx-auto mb-2" />
                                <p className="text-white/40 debate-mono text-sm">LIVE VIDEO FEED</p>
                              </div>
                            </div>
                            {currentSpeakerData.isMuted && (
                              <div className="absolute top-4 right-4 bg-red-600 text-white px-3 py-1 debate-mono text-xs font-bold">
                                MUTED
                              </div>
                            )}
                          </div>

                          <div className="mt-4 flex items-center justify-between">
                            <div className="debate-mono text-sm text-muted-foreground">
                              Total speaking time: {formatTime(currentSpeakerData.totalSpeakingTime)}
                            </div>
                            <div className="flex space-x-2">
                              <Button variant="outline" size="sm" className="debate-button">
                                RAISE HAND
                              </Button>
                              <Button variant="outline" size="sm" className="debate-button">
                                FLAG CONTENT
                              </Button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </CardContent>
                </Card>
              </div>

              {/* Audience Queue */}
              <div className="h-1/3">
                <Card className="h-full debate-card border-2">
                  <CardHeader className="border-b-2 border-border">
                    <CardTitle className="debate-title flex items-center">
                      <Users className="w-4 h-4 mr-2" />
                      AUDIENCE QUEUE ({audience.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="grid grid-cols-4 gap-3">
                      {audience.map((person, index) => (
                        <motion.div
                          key={person.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.1 }}
                          className="text-center p-3 border-2 border-border hover:border-red-600 transition-colors cursor-pointer"
                        >
                          <div className="w-12 h-12 bg-gray-600 text-white font-bold text-sm flex items-center justify-center mx-auto mb-2 border-2 border-black">
                            {getInitials(person.name)}
                          </div>
                          <p className="text-xs debate-mono font-medium truncate">{person.name}</p>
                          <p className="text-xs debate-mono text-muted-foreground">#{index + 1}</p>
                        </motion.div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Right Sidebar */}
            <div className="col-span-4 space-y-4">
              
              {/* Moderator Controls */}
              {moderator && (
                <Card className="debate-card border-2">
                  <CardHeader className="border-b-2 border-border">
                    <CardTitle className="debate-title flex items-center">
                      <Shield className="w-4 h-4 mr-2" />
                      MODERATOR
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4">
                    <div className="flex items-center space-x-3 mb-4">
                      <div className="w-10 h-10 bg-blue-600 text-white font-bold text-sm flex items-center justify-center border-2 border-black">
                        {getInitials(moderator.name)}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium debate-text">{moderator.name}</p>
                        <p className="text-xs debate-mono text-muted-foreground">Active</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsPaused(!isPaused)}
                        className="debate-button col-span-2"
                      >
                        {isPaused ? <Play className="w-4 h-4 mr-2" /> : <Pause className="w-4 h-4 mr-2" />}
                        {isPaused ? 'RESUME' : 'PAUSE'}
                      </Button>
                      <Button variant="outline" size="sm" onClick={nextSpeaker} className="debate-button">
                        <SkipForward className="w-4 h-4 mr-1" />
                        NEXT
                      </Button>
                      <Button variant="outline" size="sm" className="debate-button">
                        <MessageSquare className="w-4 h-4 mr-1" />
                        WARN
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Live Transcript */}
              <Card className="debate-card border-2 flex-1">
                <CardHeader className="border-b-2 border-border">
                  <CardTitle className="debate-title flex items-center">
                    <MessageSquare className="w-4 h-4 mr-2" />
                    LIVE TRANSCRIPT
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 h-64 overflow-y-auto">
                  <div className="space-y-3">
                    {messages.map((message) => (
                      <motion.div
                        key={message.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="border-l-2 border-gray-300 pl-3"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium debate-text text-sm">{message.participant}</span>
                          <span className="debate-mono text-xs text-muted-foreground">
                            {formatTime(30)}
                          </span>
                        </div>
                        <p className="debate-text text-sm leading-relaxed">{message.content}</p>
                        {message.type === 'claim' && (
                          <div className="mt-1">
                            <span className="debate-badge bg-blue-100 text-blue-800 text-xs">
                              FACT CLAIM DETECTED
                            </span>
                          </div>
                        )}
                      </motion.div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Analytics */}
              <Card className="debate-card border-2">
                <CardHeader className="border-b-2 border-border">
                  <CardTitle className="debate-title flex items-center">
                    <BarChart3 className="w-4 h-4 mr-2" />
                    PARTICIPATION
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="space-y-3">
                    {speakers.concat(audience.slice(0, 3)).map((person) => (
                      <div key={person.id} className="flex items-center justify-between">
                        <span className="text-sm debate-mono truncate pr-2">{person.name}</span>
                        <div className="flex items-center space-x-2">
                          <div className="w-20 bg-gray-200 rounded-full h-2">
                            <div 
                              className="bg-red-600 h-2 rounded-full"
                              style={{ width: `${Math.min(100, (person.totalSpeakingTime / 300) * 100)}%` }}
                            />
                          </div>
                          <span className="text-xs debate-mono text-muted-foreground w-12 text-right">
                            {formatTime(person.totalSpeakingTime)}
                          </span>
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