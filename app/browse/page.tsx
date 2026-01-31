'use client'

import { motion } from 'framer-motion'
import { Users, Clock, Zap, TrendingUp, Filter, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
import FloatingNav from '@/components/FloatingNav'

export default function BrowsePage() {
  const debates = [
    {
      id: 1,
      title: "Is AI consciousness possible?",
      participants: 42,
      status: "LIVE",
      category: "TECH",
      timeLeft: "45m"
    },
    {
      id: 2,
      title: "Universal Basic Income: Solution or Problem?",
      participants: 18,
      status: "LIVE",
      category: "ECON",
      timeLeft: "1h 23m"
    },
    {
      id: 3,
      title: "Climate Change: Individual vs Corporate Responsibility",
      participants: 67,
      status: "LIVE",
      category: "CLIMATE",
      timeLeft: "32m"
    },
    {
      id: 4,
      title: "Free Speech vs Hate Speech Regulation",
      participants: 31,
      status: "LIVE",
      category: "POLITICS",
      timeLeft: "54m"
    },
    {
      id: 5,
      title: "Cryptocurrency: Future of Finance?",
      participants: 23,
      status: "LIVE",
      category: "MONEY",
      timeLeft: "18m"
    },
    {
      id: 6,
      title: "Remote Work: Productivity Paradise or Isolation Trap?",
      participants: 14,
      status: "LIVE",
      category: "WORK",
      timeLeft: "1h 8m"
    },
  ]

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
              { label: "LIVE DEBATES", value: "87", icon: Zap },
              { label: "ONLINE NOW", value: "~3K", icon: Users },
              { label: "AVG LENGTH", value: "1h 42m", icon: Clock },
              { label: "THIS WEEK", value: "+47", icon: TrendingUp },
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
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {debates.map((debate, index) => (
              <motion.div
                key={debate.id}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + index * 0.1 }}
              >
                <Link href={`/room/${debate.id}`}>
                  <Card className="debate-card cursor-pointer h-full">
                    <CardHeader>
                      <div className="flex items-start justify-between mb-3">
                        <span className="debate-badge bg-red-600 text-white">
                          {debate.status}
                        </span>
                        <span className="debate-mono text-xs text-gray-400">
                          {debate.timeLeft}
                        </span>
                      </div>
                      <CardTitle className="text-xl font-black text-white">
                        {debate.title}
                      </CardTitle>
                      <CardDescription className="debate-mono text-sm text-gray-400 mt-2">
                        {debate.category}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-2 text-gray-300">
                        <Users className="w-4 h-4" />
                        <span className="font-bold">{debate.participants}</span>
                        <span className="text-sm">participants</span>
                      </div>
                      <Button className="debate-button bg-red-600 text-white border-black w-full mt-4">
                        JOIN DEBATE
                      </Button>
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            ))}
          </div>

          {/* Load More */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
            className="mt-12 text-center"
          >
            <Button className="debate-button bg-white text-black border-black px-12 py-4">
              LOAD MORE DEBATES
            </Button>
          </motion.div>
        </div>
      </main>
    </div>
  )
}
