"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowRight, Mail, Lock, Zap, Shield, Users } from "lucide-react"
import { ensureUserProfile } from "@/lib/actions/user"

export default function AuthPage() {
  const [isSignUp, setIsSignUp] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
    }

    await ensureUserProfile()
    router.push("/")
    router.refresh()
    setLoading(false)
  }

  return (
    <div className="min-h-screen debate-container bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 dark flex items-center justify-center relative">
      <div className="debate-texture fixed inset-0" />

      {/* Decorative elements */}
      <div className="absolute top-20 left-10 w-32 h-32 border-2 border-red-600/20 rotate-12" />
      <div className="absolute bottom-20 right-10 w-48 h-48 border-2 border-blue-600/10 -rotate-6" />
      <div className="absolute top-1/3 right-1/4 w-4 h-4 bg-red-600/40" />
      <div className="absolute bottom-1/3 left-1/4 w-6 h-6 bg-yellow-400/20 rotate-45" />

      <div className="relative z-10 w-full max-w-5xl mx-auto px-6 grid md:grid-cols-2 gap-12 items-center">
        {/* Left side — branding */}
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          className="hidden md:block"
        >
          <h1 className="text-6xl font-black text-white debate-title mb-6">
            STEP INTO<br />
            THE <span className="text-red-400">ARENA</span>
          </h1>
          <p className="text-xl text-gray-300 debate-text mb-10 max-w-md">
            Where ideas clash and the best arguments win. Join structured debates with real-time moderation.
          </p>

          <div className="space-y-4">
            {[
              { icon: Zap, label: "LIVE DEBATES", desc: "Real-time structured arguments" },
              { icon: Shield, label: "MODERATED", desc: "Fair rules, enforced turns" },
              { icon: Users, label: "COMMUNITY", desc: "Thousands of active debaters" },
            ].map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.15 }}
                className="flex items-center gap-4"
              >
                <div className="w-10 h-10 border-2 border-white/20 bg-white/5 flex items-center justify-center" style={{ transform: "skew(-2deg)" }}>
                  <item.icon className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <div className="text-sm font-bold debate-mono text-white">{item.label}</div>
                  <div className="text-xs text-gray-400 debate-text">{item.desc}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Right side — auth form */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <div className="bg-gray-900 border-2 border-white/20 p-8 shadow-[8px_8px_0px_rgba(0,0,0,0.3)]">
            {/* Mobile title */}
            <div className="md:hidden mb-6">
              <h1 className="text-3xl font-black text-white debate-title">
                ARGUABLY
              </h1>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={isSignUp ? "signup" : "signin"}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <h2 className="text-2xl font-bold debate-title text-white mb-1">
                  {isSignUp ? "CREATE ACCOUNT" : "SIGN IN"}
                </h2>
                <p className="text-sm debate-mono text-gray-400 mb-6">
                  {isSignUp ? "Join the debate community" : "Welcome back, debater"}
                </p>
              </motion.div>
            </AnimatePresence>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-bold debate-mono mb-2 text-gray-300 uppercase tracking-wider">
                  <Mail className="w-3.5 h-3.5 inline mr-2" />
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  className="debate-input w-full"
                />
              </div>

              <div>
                <label className="block text-xs font-bold debate-mono mb-2 text-gray-300 uppercase tracking-wider">
                  <Lock className="w-3.5 h-3.5 inline mr-2" />
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="Min 6 characters"
                  className="debate-input w-full"
                />
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-red-600/10 border-2 border-red-600/30 p-3"
                >
                  <p className="text-sm debate-mono text-red-400">{error}</p>
                </motion.div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full debate-button bg-red-600 text-white border-red-700 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <span className="debate-mono text-sm">LOADING...</span>
                ) : (
                  <>
                    <span className="debate-mono text-sm">
                      {isSignUp ? "CREATE ACCOUNT" : "ENTER ARENA"}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 pt-6 border-t-2 border-white/10 text-center">
              <p className="text-sm text-gray-400 debate-text">
                {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
                <button
                  onClick={() => {
                    setIsSignUp(!isSignUp)
                    setError(null)
                  }}
                  className="text-red-400 font-bold hover:text-red-300 debate-mono transition-colors"
                >
                  {isSignUp ? "SIGN IN" : "SIGN UP"}
                </button>
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
