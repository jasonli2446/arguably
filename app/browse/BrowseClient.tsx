'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Users, Clock, Zap, TrendingUp, Filter, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import FloatingNav from '@/components/FloatingNav'
import { useRouter } from 'next/navigation'
import { joinSession } from '@/lib/actions/session'

interface SessionData {
  id: string
  code: string
  name: string
  type: string
  status: string
  created_at: string
  max_participants: number
  turn_length: number
  moderator: { username: string }
  _count: { participatesIns: number }
}

const TYPE_LABELS: Record<string, string> = {
  EXPERT_VS_CROWD: 'EXPERT',
  ONE_ON_ONE: '1v1',
  TEAM: 'TEAM',
  PANEL: 'PANEL',
}

const STATUS_COLORS: Record<string, string> = {
  LIVE: 'bg-red-600',
  WAITING: 'bg-yellow-500',
  PAUSED: 'bg-gray-500',
}

export default function BrowseClient({ sessions }: { sessions: SessionData[] }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [joiningId, setJoiningId] = useState<string | null>(null)
  const router = useRouter()

  const filtered = sessions.filter((s) =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const liveCount = sessions.filter((s) => s.status === 'LIVE').length
  const totalParticipants = sessions.reduce((sum, s) => sum + s._count.participatesIns, 0)

  async function handleJoin(session: SessionData) {
    setJoiningId(session.id)
    try {
      await joinSession(session.id)
      router.push(`/room/${session.code}`)
    } catch (err) {
      console.error('Failed to join:', err)
      // Navigate anyway — they can still view
      router.push(`/room/${session.code}`)
    }
  }

  return (
    <div className="min-h-screen debate-container bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 dark">
      <div className="debate-texture fixed inset-0" />
      <FloatingNav />

      <main className="relative z-10 pt-32 pb-20">
        <div className="container mx-auto px-6">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mb-12"
          >
            <h1 className="text-6xl md:text-7xl font-black text-white mb-4">
              BROWSE <span className="text-red-400">DEBATES</span>
            </h1>
            <p className="text-xl text-gray-300 max-w-2xl">
              Jump into a live room or spectate from the queue
            </p>
          </motion.div>

          {/* Filter Bar */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mb-8 flex flex-col md:flex-row gap-4"
          >
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="SEARCH DEBATES..."
                className="debate-input w-full pl-12"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button className="debate-button bg-white text-black border-black">
              <Filter className="w-4 h-4 mr-2" />
              FILTER
            </Button>
          </motion.div>

          {/* Stats Bar */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12"
          >
            {[
              { label: "LIVE DEBATES", value: String(liveCount), icon: Zap },
              { label: "PARTICIPANTS", value: String(totalParticipants), icon: Users },
              { label: "TOTAL ROOMS", value: String(sessions.length), icon: Clock },
              { label: "FORMATS", value: "4", icon: TrendingUp },
            ].map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + index * 0.1 }}
                className="bg-gray-900 border-2 border-white/20 p-4 text-center"
              >
                <stat.icon className="w-6 h-6 text-red-400 mx-auto mb-2" />
                <div className="text-3xl font-black text-white mb-1">{stat.value}</div>
                <div className="text-xs debate-mono text-gray-400">{stat.label}</div>
              </motion.div>
            ))}
          </motion.div>

          {/* Debates Grid */}
          {filtered.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-20"
            >
              <p className="text-2xl font-bold debate-title text-gray-500 mb-4">
                {searchQuery ? 'NO MATCHING DEBATES' : 'NO ACTIVE DEBATES'}
              </p>
              <p className="text-gray-400 debate-text">
                {searchQuery ? 'Try a different search term' : 'Be the first to create one!'}
              </p>
            </motion.div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filtered.map((session, index) => (
                <motion.div
                  key={session.id}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 + index * 0.1 }}
                >
                  <Card className="debate-card cursor-pointer h-full">
                    <CardHeader>
                      <div className="flex items-start justify-between mb-3">
                        <span className={`debate-badge text-white ${STATUS_COLORS[session.status] || 'bg-gray-600'}`}>
                          {session.status}
                        </span>
                        <span className="debate-mono text-xs text-gray-400">
                          {session.code}
                        </span>
                      </div>
                      <CardTitle className="text-xl font-black text-white">
                        {session.name}
                      </CardTitle>
                      <CardDescription className="debate-mono text-sm text-gray-400 mt-2">
                        {TYPE_LABELS[session.type] || session.type}
                        <span className="mx-2">·</span>
                        by {session.moderator.username}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-2 text-gray-300">
                        <Users className="w-4 h-4" />
                        <span className="font-bold">{session._count.participatesIns}</span>
                        <span className="text-sm">/ {session.max_participants}</span>
                      </div>
                      <Button
                        className="debate-button bg-red-600 text-white border-black w-full mt-4"
                        onClick={() => handleJoin(session)}
                        disabled={joiningId === session.id}
                      >
                        {joiningId === session.id ? 'JOINING...' : 'JOIN DEBATE'}
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
