'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Users, Clock, Settings, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import Link from 'next/link'

export default function CreateRoom() {
  const [selectedFormat, setSelectedFormat] = useState<string>('expert-crowd')
  const [roomName, setRoomName] = useState('')
  const [turnLength, setTurnLength] = useState('120')
  const [maxParticipants, setMaxParticipants] = useState('10')

  const debateFormats = [
    {
      id: 'expert-crowd',
      title: 'EXPERT vs CROWD',
      description: 'One expert faces rotating challengers from the audience queue.',
      icon: Users,
      color: 'border-red-600 bg-red-950',
      features: ['Audience queue', 'Dynamic replacement', 'Expert protection']
    },
    {
      id: 'one-on-one',
      title: 'ONE-ON-ONE',
      description: 'Classic two-person debate with strict turn-taking and time limits.',
      icon: Users,
      color: 'border-blue-600 bg-blue-950',
      features: ['Strict moderation', 'Equal time', 'Direct confrontation']
    },
    {
      id: 'team',
      title: 'TEAM DEBATE',
      description: 'Collaborative team competition with coordinated arguments.',
      icon: Users,
      color: 'border-green-600 bg-green-950',
      features: ['Team coordination', 'Shared strategy', 'Collaborative']
    },
    {
      id: 'panel',
      title: 'PANEL DISCUSSION',
      description: 'Multiple debaters in circular queue with equal time allocation.',
      icon: Users,
      color: 'border-purple-600 bg-purple-950',
      features: ['Equal speaking time', 'Circular queue', 'Multiple perspectives']
    }
  ]

  return (
    <div className="min-h-screen debate-container bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 dark">
      <div className="debate-grid fixed inset-0 opacity-30" />
      
      <header className="relative z-10 border-b-2 border-white/20 bg-gray-900/90 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Link href="/">
                <Button variant="ghost" size="sm" className="debate-button">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  BACK
                </Button>
              </Link>
              <h1 className="text-2xl font-bold debate-title text-white">CREATE DEBATE ROOM</h1>
            </div>
            <div className="debate-mono text-sm text-gray-400">
              STEP 1 OF 2
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <div className="bg-gray-900 border-2 border-white/20 p-6 rounded-none">
              <h2 className="text-xl font-bold debate-title mb-4 text-white">ROOM DETAILS</h2>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-bold debate-mono mb-2 text-white">ROOM NAME</label>
                  <Input
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    placeholder="Enter debate topic..."
                    className="debate-input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold debate-mono mb-2 text-white">ROOM ID</label>
                  <Input
                    value="ARG-2478"
                    disabled
                    className="debate-input bg-gray-800 text-gray-400 border-white/10"
                  />
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-8"
          >
            <h2 className="text-xl font-bold debate-title mb-6 text-white">SELECT DEBATE FORMAT</h2>
            <div className="grid md:grid-cols-2 gap-6">
              {debateFormats.map((format) => (
                <motion.div
                  key={format.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Card
                    className={`cursor-pointer transition-all border-2 ${
                      selectedFormat === format.id
                        ? `${format.color} border-opacity-100`
                        : 'bg-gray-900 border-white/20 hover:border-white/40'
                    }`}
                    onClick={() => setSelectedFormat(format.id)}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-3">
                           <div className={`w-10 h-10 rounded-md border-2 border-white/20 flex items-center justify-center ${
                             selectedFormat === format.id ? 'bg-white text-black' : 'bg-gray-800 text-gray-400'
                           }`}>
                            {selectedFormat === format.id && <Check className="w-5 h-5" />}
                          </div>
                          <div>
                            <CardTitle className="debate-title text-lg text-white">{format.title}</CardTitle>
                            <CardDescription className="debate-text mt-1 text-gray-300">
                              {format.description}
                            </CardDescription>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {format.features.map((feature, index) => (
                          <div key={index} className="flex items-center space-x-2">
                            <div className="w-1.5 h-1.5 bg-gray-400 rounded-full" />
                            <span className="text-xs debate-mono text-gray-300">{feature}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mb-8"
          >
            <div className="bg-gray-900 border-2 border-white/20 p-6 rounded-none">
              <h2 className="text-xl font-bold debate-title mb-6 text-white">RULES & SETTINGS</h2>
              <div className="grid md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-bold debate-mono mb-2 text-white">
                    <Clock className="w-4 h-4 inline mr-2" />
                    TURN LENGTH
                  </label>
                  <select
                    value={turnLength}
                    onChange={(e) => setTurnLength(e.target.value)}
                    className="debate-input w-full"
                  >
                    <option value="60">60 seconds</option>
                    <option value="120">120 seconds</option>
                    <option value="180">180 seconds</option>
                    <option value="300">5 minutes</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold debate-mono mb-2 text-white">
                    <Users className="w-4 h-4 inline mr-2" />
                    MAX PARTICIPANTS
                  </label>
                  <select
                    value={maxParticipants}
                    onChange={(e) => setMaxParticipants(e.target.value)}
                    className="debate-input w-full"
                  >
                    <option value="4">4 participants</option>
                    <option value="10">10 participants</option>
                    <option value="20">20 participants</option>
                    <option value="50">50 participants</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold debate-mono mb-2 text-white">
                    <Settings className="w-4 h-4 inline mr-2" />
                    MODERATION
                  </label>
                  <select className="debate-input w-full">
                    <option>Auto-moderate</option>
                    <option>Manual moderation</option>
                    <option>No moderation</option>
                  </select>
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex justify-between items-center"
          >
            <div className="debate-mono text-sm text-gray-400">
              Room ID: <span className="font-bold text-white">ARG-2478</span>
            </div>
            <div className="space-x-4">
              <Button variant="outline" className="debate-button">
                SAVE DRAFT
              </Button>
              <Button className="debate-button variant-debate">
                CREATE ROOM
                <ArrowLeft className="w-4 h-4 ml-2 rotate-180" />
              </Button>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  )
}