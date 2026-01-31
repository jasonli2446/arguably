'use client'

import { motion } from 'framer-motion'
import { ArrowRight, Users, Clock, Shield, Mic, BarChart3, Zap, Play, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
import FloatingNav from '@/components/FloatingNav'

export default function Home() {
  return (
    <div className="min-h-screen debate-container bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 dark">
      <div className="debate-texture fixed inset-0" />
      <FloatingNav />

      <main className="relative z-10 pt-32">
        <section className="container mx-auto px-6 pb-24">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, type: "spring" }}
            className="max-w-6xl mx-auto"
          >
            {/* Asymmetrical hero layout */}
            <div className="grid lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-7 space-y-6">
                <motion.div
                  initial={{ opacity: 0, x: -50 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <motion.div
                    className="inline-block"
                    whileHover={{ scale: 1.05 }}
                    transition={{ type: "spring", stiffness: 400 }}
                  >
                    <span className="debate-badge bg-yellow-400 text-black">
                      <Zap className="w-3 h-3 inline mr-2" />
                      LIVE DEBATES
                    </span>
                  </motion.div>
                </motion.div>

                <h1 className="text-6xl md:text-7xl lg:text-8xl xl:text-9xl font-black leading-none">
                  <motion.span
                    className="block text-white"
                    initial={{ opacity: 0, x: -100 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3, type: "spring" }}
                  >
                    ARGUE.
                  </motion.span>
                  <motion.span
                    className="block text-red-400 mt-2"
                    initial={{ opacity: 0, x: 100 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4, type: "spring" }}
                  >
                    DEBATE.
                  </motion.span>
                </h1>

                <motion.p
                  className="text-lg md:text-xl lg:text-2xl text-gray-300 leading-relaxed"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                >
                  Real-time moderation meets intellectual combat.
                  <span className="block text-red-400 font-semibold">No interruptions. No filibustering.</span>
                </motion.p>

                <motion.div
                  className="flex flex-col sm:flex-row gap-4 pt-8"
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 }}
                >
                  <Link href="/create">
                    <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                      <Button className="debate-button bg-red-600 text-white text-lg px-8 py-4">
                        START DEBATING
                        <ArrowRight className="ml-2 w-5 h-5" />
                      </Button>
                    </motion.div>
                  </Link>
                  <Link href="/room/demo">
                    <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                      <Button variant="outline" className="debate-button text-lg px-8 py-4">
                        <Play className="mr-2 w-5 h-5" />
                        WATCH LIVE
                      </Button>
                    </motion.div>
                  </Link>
                </motion.div>
              </div>

              {/* Decorative element - absolute on mobile, grid on desktop */}
              <div className="lg:col-span-5 relative hidden lg:block">
                <motion.div
                  initial={{ opacity: 0, scale: 0.8, rotate: -5 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  transition={{ delay: 0.7, type: "spring" }}
                  className="relative"
                >
                  <div className="absolute -top-8 -right-8 w-32 h-32 bg-yellow-400 border-2 border-black animate-float" />
                  <div className="absolute -bottom-4 -left-4 w-24 h-24 bg-blue-600 border-2 border-black animate-float" style={{ animationDelay: '2s' }} />
                  <div className="relative bg-gray-900 border-2 border-white/20 p-8 rotate-2 skew-y-1">
                    <div className="text-center space-y-4">
                      <div className="text-6xl font-black">247</div>
                      <div className="text-sm debate-mono uppercase text-gray-300">ACTIVE DEBATES</div>
                      <div className="flex justify-center space-x-2 pt-4">
                        <div className="w-2 h-2 bg-red-600 animate-pulse" />
                        <div className="w-2 h-2 bg-red-600 animate-pulse" style={{ animationDelay: '0.5s' }} />
                        <div className="w-2 h-2 bg-red-600 animate-pulse" style={{ animationDelay: '1s' }} />
                      </div>
                    </div>
                  </div>
                </motion.div>
              </div>
            </div>

            {/* Mobile version of active debates card */}
            <div className="lg:hidden mt-12">
              <motion.div
                initial={{ opacity: 0, scale: 0.8, rotate: -5 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                transition={{ delay: 0.7, type: "spring" }}
                className="relative mx-auto max-w-xs"
              >
                <div className="absolute -top-6 -right-6 w-24 h-24 bg-yellow-400 border-2 border-black animate-float" />
                <div className="absolute -bottom-3 -left-3 w-20 h-20 bg-blue-600 border-2 border-black animate-float" style={{ animationDelay: '2s' }} />
                <div className="relative bg-gray-900 border-2 border-white/20 p-6 rotate-1 skew-y-1">
                  <div className="text-center space-y-3">
                    <div className="text-5xl font-black">247</div>
                    <div className="text-xs debate-mono uppercase text-gray-300">ACTIVE DEBATES</div>
                    <div className="flex justify-center space-x-2 pt-2">
                      <div className="w-2 h-2 bg-red-600 animate-pulse" />
                      <div className="w-2 h-2 bg-red-600 animate-pulse" style={{ animationDelay: '0.5s' }} />
                      <div className="w-2 h-2 bg-red-600 animate-pulse" style={{ animationDelay: '1s' }} />
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </section>

        {/* Features Section - More organic layout */}
        <section className="py-32 relative">
          <div className="container mx-auto px-6">
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="text-center mb-20"
            >
              <h2 className="text-5xl md:text-7xl font-black mb-6 text-white">
                ENGINEERED FOR <span className="text-red-400">TRUTH</span>
              </h2>
              <p className="text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed">
                Every feature designed for intellectual combat. No generic conferencing tools here.
              </p>
            </motion.div>

            {/* Asymmetrical feature grid */}
            <div className="grid lg:grid-cols-12 gap-8">
              {/* Large feature card */}
              <motion.div
                initial={{ opacity: 0, x: -50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                className="lg:col-span-7"
              >
                <div className="bg-gray-900 border-2 border-white/20 p-8 hover:transform hover:translate-y-[-8px] transition-all duration-300">
                  <div className="flex items-start space-x-6">
                    <div className="w-16 h-16 bg-red-600 border-2 border-black flex items-center justify-center flex-shrink-0">
                      <Shield className="w-8 h-8 text-white" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-black mb-4 text-white">LIVE MODERATION</h3>
                      <p className="text-gray-300 leading-relaxed mb-4">
                        Real-time moderator controls. Pause debates, remove participants, enforce rules instantly. No more chaos, just structured discourse.
                      </p>
                      <motion.button
                        className="text-sm debate-mono font-semibold flex items-center group text-white"
                        whileHover={{ x: 4 }}
                      >
                        LEARN MORE <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                      </motion.button>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Small features */}
              <div className="lg:col-span-5 space-y-8">
                {[
                  {
                    icon: Clock,
                    title: "TIMED TURNS",
                    description: "No interruptions, no filibustering",
                    color: "bg-blue-600"
                  },
                  {
                    icon: Mic,
                    title: "LIVE TRANSCRIPTION",
                    description: "Every word captured, searchable",
                    color: "bg-yellow-600"
                  }
                ].map((feature, index) => (
                  <motion.div
                    key={feature.title}
                    initial={{ opacity: 0, x: 50 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 }}
                    className="bg-gray-900 border-2 border-white/20 p-6"
                  >
                    <div className="flex items-center space-x-4">
                      <div className={`w-12 h-12 ${feature.color} border-2 border-black flex items-center justify-center flex-shrink-0`}>
                        <feature.icon className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h4 className="font-bold text-lg text-white">{feature.title}</h4>
                        <p className="text-sm text-gray-300">{feature.description}</p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Bottom features row */}
              <div className="lg:col-span-12 grid md:grid-cols-3 gap-8 mt-8">
                {[
                  {
                    icon: Users,
                    title: "DYNAMIC ROLES",
                    description: "Session-based participant management with seamless role transitions",
                    color: "bg-purple-600"
                  },
                  {
                    icon: BarChart3,
                    title: "CLAIM DETECTION",
                    description: "AI-powered fact-checking with automatic source surfacing",
                    color: "bg-green-600"
                  },
                  {
                    icon: Zap,
                    title: "AUDIENCE QUEUE",
                    description: "Smart replacement system maintains continuous debate flow",
                    color: "bg-red-600"
                  }
                ].map((feature, index) => (
                  <motion.div
                    key={feature.title}
                    initial={{ opacity: 0, y: 30 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 }}
                    className="bg-gray-900 border-2 border-white/20 p-6 text-center"
                  >
                    <div className={`${feature.color} w-16 h-16 border-2 border-black flex items-center justify-center mx-auto mb-4`}>
                      <feature.icon className="w-8 h-8 text-white" />
                    </div>
                    <h4 className="font-bold text-lg mb-2 text-white">{feature.title}</h4>
                    <p className="text-sm text-gray-300">{feature.description}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Formats Section - More creative layout */}
        <section className="py-32 relative overflow-hidden">
          <div className="container mx-auto px-6">
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="text-center mb-20"
            >
              <h2 className="text-5xl md:text-7xl font-black mb-6 text-white">
                DEBATE <span className="text-red-400">FORMATS</span>
              </h2>
              <p className="text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed">
                From intellectual one-on-ones to chaotic crowd debates
              </p>
            </motion.div>

            {/* Diagonal format cards */}
            <div className="relative">
              <motion.div
                initial={{ opacity: 0, rotate: -2 }}
                whileInView={{ opacity: 1, rotate: 0 }}
                viewport={{ once: true }}
                className="grid md:grid-cols-2 gap-8"
              >
                {/* Expert vs Crowd - Featured */}
                <div className="md:col-span-2">
                  <div className="bg-gradient-to-br from-red-600 to-red-800 border-2 border-white/20 p-8 text-white relative overflow-hidden">
                    <div className="absolute top-4 right-4">
                      <span className="debate-badge bg-white text-black">MOST POPULAR</span>
                    </div>
                    <div className="relative z-10">
                      <h3 className="text-3xl font-black mb-4">EXPERT vs CROWD</h3>
                      <p className="text-lg mb-4 opacity-90">
                        One expert faces rotating challengers from the audience queue. Survival of the intellectual fittest.
                      </p>
                      <div className="flex items-center space-x-4">
                        <span className="debate-mono text-sm bg-white/20 px-3 py-1">1 vs MANY</span>
                        <Button className="debate-button bg-white text-black hover:bg-gray-100">
                          START EXPERT MODE
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Other formats */}
                {[
                  {
                    title: "ONE-ON-ONE",
                    description: "Classic intellectual combat. Pure, focused debate.",
                    participants: "1 vs 1",
                    color: "from-blue-600 to-blue-800"
                  },
                  {
                    title: "TEAM DEBATE",
                    description: "Collaborative strategy meets coordinated attacks.",
                    participants: "TEAM vs TEAM",
                    color: "from-green-600 to-green-800"
                  }
                ].map((format, index) => (
                  <motion.div
                    key={format.title}
                    initial={{ opacity: 0, y: 30 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 }}
                    className={`bg-gradient-to-br ${format.color} border-2 border-white/20 p-6 text-white`}
                  >
                    <span className="debate-mono text-xs opacity-80">{format.participants}</span>
                    <h3 className="text-xl font-bold mb-2 mt-2">{format.title}</h3>
                    <p className="text-sm opacity-90">{format.description}</p>
                  </motion.div>
                ))}
              </motion.div>

              {/* Panel format - tilted */}
              <motion.div
                initial={{ opacity: 0, rotate: 2 }}
                whileInView={{ opacity: 1, rotate: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 }}
                className="mt-8"
              >
                <div className="bg-gradient-to-br from-purple-600 to-purple-800 border-2 border-white/20 p-6 text-white md:w-3/4 mx-auto">
                  <span className="debate-mono text-xs opacity-80">MULTIPLE PERSPECTIVES</span>
                  <h3 className="text-xl font-bold mb-2 mt-2">PANEL DISCUSSION</h3>
                  <p className="text-sm opacity-90">
                    Multiple debaters in circular queue with equal time allocation. Democracy in action.
                  </p>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* CTA Section - More dramatic */}
        <section className="py-32 relative">
          <div className="container mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ type: "spring", stiffness: 200 }}
              className="relative"
            >
              {/* Background decoration */}
              <div className="absolute inset-0 bg-black transform rotate-1 scale-105" />

              <div className="relative bg-gray-900 border-2 border-white/20 p-12 text-center">
                <motion.div
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.2 }}
                >
                  <h2 className="text-4xl md:text-6xl font-black mb-6 text-white">
                    READY TO <span className="text-red-400">DEBATE?</span>
                  </h2>
                  <p className="text-xl text-gray-300 mb-8 max-w-2xl mx-auto leading-relaxed">
                    Join the intellectual revolution. Structured debate meets modern technology.
                  </p>

                  <div className="flex flex-col sm:flex-row gap-6 justify-center items-center">
                    <Link href="/create">
                      <motion.div
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        <Button className="debate-button bg-red-600 text-white text-lg px-8 py-4">
                          CREATE YOUR DEBATE
                        </Button>
                      </motion.div>
                    </Link>

                    <div className="flex items-center space-x-4 text-sm debate-mono">
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 bg-green-600 rounded-full animate-pulse" />
                        <span>247 DEBATES LIVE</span>
                      </div>
                      <div className="text-gray-400">•</div>
                      <div className="text-gray-300">12,841 DEBATERS</div>
                    </div>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          </div>
        </section>
      </main>

      {/* Footer - Minimalist */}
      <footer className="relative z-10 bg-black text-white py-8">
        <div className="container mx-auto px-6">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center space-x-3 mb-6 md:mb-0">
              <div className="w-8 h-8 bg-red-600 border-2 border-white" />
              <span className="font-black text-lg">ARGUABLY</span>
            </div>
            <div className="flex space-x-8 debate-mono text-sm">
              <a href="#" className="hover:text-red-600 transition-colors">TERMS</a>
              <a href="#" className="hover:text-red-600 transition-colors">PRIVACY</a>
              <a href="#" className="hover:text-red-600 transition-colors">CONTACT</a>
            </div>
          </div>
          <div className="text-center mt-8 debate-mono text-xs opacity-50">
            © 2024 ARGUABLY. STRUCTURED DEBATE PLATFORM.
          </div>
        </div>
      </footer>
    </div>
  )
}
