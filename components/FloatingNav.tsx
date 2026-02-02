'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Menu, X, Users, Settings, LogOut, Home, Plus, Compass, UserCircle, LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { User } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'

export default function FloatingNav() {
  const [isOpen, setIsOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY
      setScrolled(currentScrollY > 50)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    // Check for current user
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      setLoading(false)
    }

    checkUser()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  const navItems = user ? [
    { label: 'HOME', href: '/', icon: Home },
    { label: 'CREATE', href: '/create', icon: Plus },
    { label: 'BROWSE', href: '/browse', icon: Compass },
    { label: 'SETTINGS', href: '/settings', icon: Settings },
  ] : [
    { label: 'HOME', href: '/', icon: Home },
    { label: 'BROWSE', href: '/browse', icon: Compass },
  ]

  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-50 flex justify-center">
        <div
          className={`transition-all duration-500 ease-out ${
            scrolled ? 'w-auto mt-4' : 'w-full mt-0'
          }`}
        >
          <div
            className={`transition-all duration-500 ease-out ${
              scrolled
                ? 'bg-white/95 dark:bg-black/95 backdrop-blur-md border-2 border-gray-300 dark:border-white/30 shadow-[8px_8px_0px_rgba(0,0,0,0.2)] dark:shadow-[8px_8px_0px_rgba(0,0,0,0.5)] px-6'
                : 'bg-transparent border-b-2 border-gray-200 dark:border-white/10'
            }`}
            style={{
              transform: scrolled ? 'skew(-1deg)' : 'none',
            }}
          >
            <div className={scrolled ? '' : 'container mx-auto px-6'}>
              <div className={`flex items-center justify-between transition-all duration-500 ${
                scrolled ? 'py-3 gap-3' : 'py-5'
              }`}>
              {/* Logo */}
              <a
                href="/"
                className={`flex items-center gap-3 relative z-10 transition-all duration-700 ${
                  scrolled ? 'scale-90' : 'scale-100'
                }`}
              >
                <div
                  className={`bg-red-600 border-2 border-gray-900 dark:border-white shadow-[4px_4px_0px_rgba(0,0,0,0.3)] transition-all duration-700 ${
                    scrolled ? 'w-7 h-7' : 'w-8 h-8'
                  }`}
                />
                <h1
                  className={`font-black tracking-tight text-gray-900 dark:text-white transition-all duration-700 ${
                    scrolled ? 'text-base' : 'text-xl'
                  }`}
                >
                  ARGUABLY
                </h1>
              </a>

              {/* Desktop Navigation */}
              <div className="hidden md:flex items-center gap-2">
                {navItems.map((item) => (
                  <a
                    key={item.label}
                    href={item.href}
                    className={`flex items-center gap-2 font-bold border-2 border-gray-900 dark:border-white bg-transparent text-gray-900 dark:text-white hover:bg-gray-900 hover:text-white dark:hover:bg-white dark:hover:text-black shadow-[3px_3px_0px_rgba(0,0,0,0.3)] hover:shadow-[5px_5px_0px_rgba(0,0,0,0.5)] transition-all duration-300 ${
                      scrolled ? 'px-3 py-2 text-xs' : 'px-4 py-2.5 text-sm'
                    }`}
                    style={{
                      transform: 'skew(-2deg)',
                    }}
                  >
                    <item.icon className={`transition-all duration-700 ${scrolled ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
                    <span className="whitespace-nowrap">{item.label}</span>
                  </a>
                ))}

                {/* Auth buttons */}
                {!loading && (
                  user ? (
                    <button
                      onClick={handleSignOut}
                      className={`flex items-center gap-2 font-bold border-2 border-red-400 bg-transparent text-red-400 hover:bg-red-400 hover:text-white shadow-[3px_3px_0px_rgba(0,0,0,0.3)] hover:shadow-[5px_5px_0px_rgba(0,0,0,0.5)] transition-all duration-300 ${
                        scrolled ? 'px-3 py-2 text-xs' : 'px-4 py-2.5 text-sm'
                      }`}
                      style={{
                        transform: 'skew(-2deg)',
                      }}
                    >
                      <LogOut className={`transition-all duration-700 ${scrolled ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
                      <span className="whitespace-nowrap">LOGOUT</span>
                    </button>
                  ) : (
                    <>
                      <a
                        href="/auth"
                        className={`flex items-center gap-2 font-bold border-2 border-gray-900 dark:border-white bg-transparent text-gray-900 dark:text-white hover:bg-gray-900 hover:text-white dark:hover:bg-white dark:hover:text-black shadow-[3px_3px_0px_rgba(0,0,0,0.3)] hover:shadow-[5px_5px_0px_rgba(0,0,0,0.5)] transition-all duration-300 ${
                          scrolled ? 'px-3 py-2 text-xs' : 'px-4 py-2.5 text-sm'
                        }`}
                        style={{
                          transform: 'skew(-2deg)',
                        }}
                      >
                        <LogIn className={`transition-all duration-700 ${scrolled ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
                        <span className="whitespace-nowrap">SIGN IN</span>
                      </a>
                      <a
                        href="/auth"
                        className={`flex items-center gap-2 font-bold border-2 border-red-600 bg-red-600 text-white hover:bg-red-700 shadow-[3px_3px_0px_rgba(0,0,0,0.3)] hover:shadow-[5px_5px_0px_rgba(0,0,0,0.5)] transition-all duration-300 ${
                          scrolled ? 'px-3 py-2 text-xs' : 'px-4 py-2.5 text-sm'
                        }`}
                        style={{
                          transform: 'skew(-2deg)',
                        }}
                      >
                        <UserCircle className={`transition-all duration-700 ${scrolled ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
                        <span className="whitespace-nowrap">SIGN UP</span>
                      </a>
                    </>
                  )
                )}
              </div>

              {/* Mobile menu button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsOpen(!isOpen)}
                className={`md:hidden p-2 border-2 transition-all hover:bg-gray-900 hover:text-white dark:hover:bg-white dark:hover:text-black ${
                  scrolled
                    ? 'text-gray-900 dark:text-white border-gray-900 dark:border-white w-9 h-9'
                    : 'text-gray-900 dark:text-white border-gray-900 dark:border-white w-10 h-10'
                }`}
                style={{
                  transform: 'skew(-2deg)'
                }}
              >
                <motion.div
                  animate={{ rotate: isOpen ? 90 : 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {isOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
                </motion.div>
              </Button>
            </div>
          </div>

          {/* Mobile dropdown menu */}
          <AnimatePresence>
            {isOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="md:hidden border-t-2 border-gray-200 dark:border-white/20 bg-white/98 dark:bg-black/98 backdrop-blur-md overflow-hidden"
              >
                <div className="p-4 space-y-2">
                  {navItems.map((item, index) => (
                    <motion.a
                      key={item.label}
                      href={item.href}
                      className="flex items-center gap-3 px-4 py-3 border-2 border-gray-300 dark:border-white/30 hover:border-gray-900 dark:hover:border-white hover:bg-gray-100 dark:hover:bg-white/10 transition-all text-gray-900 dark:text-white font-bold"
                      onClick={() => setIsOpen(false)}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ delay: index * 0.05 }}
                      whileHover={{ x: 4 }}
                      style={{ transform: 'skew(-1deg)' }}
                    >
                      <item.icon className="w-5 h-5" />
                      <span>{item.label}</span>
                    </motion.a>
                  ))}
                  <div className="pt-2 mt-2 border-t-2 border-gray-200 dark:border-white/20">
                    {!loading && (
                      user ? (
                        <motion.button
                          onClick={handleSignOut}
                          className="w-full flex items-center gap-3 px-4 py-3 border-2 border-red-400/50 hover:border-red-400 hover:bg-red-600/20 transition-all text-red-400 font-bold"
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.25 }}
                          whileHover={{ x: 4 }}
                          style={{ transform: 'skew(-1deg)' }}
                        >
                          <LogOut className="w-5 h-5" />
                          <span>LOGOUT</span>
                        </motion.button>
                      ) : (
                        <>
                          <motion.a
                            href="/auth"
                            className="flex items-center gap-3 px-4 py-3 border-2 border-gray-400 dark:border-white/50 hover:border-gray-900 dark:hover:border-white hover:bg-gray-100 dark:hover:bg-white/10 transition-all text-gray-900 dark:text-white font-bold mb-2"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.25 }}
                            whileHover={{ x: 4 }}
                            style={{ transform: 'skew(-1deg)' }}
                          >
                            <LogIn className="w-5 h-5" />
                            <span>SIGN IN</span>
                          </motion.a>
                          <motion.a
                            href="/auth"
                            className="flex items-center gap-3 px-4 py-3 border-2 border-red-600 bg-red-600 hover:bg-red-700 transition-all text-white font-bold"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.3 }}
                            whileHover={{ x: 4 }}
                            style={{ transform: 'skew(-1deg)' }}
                          >
                            <UserCircle className="w-5 h-5" />
                            <span>SIGN UP</span>
                          </motion.a>
                        </>
                      )
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Floating action button - only show when scrolled */}
      <AnimatePresence>
        {scrolled && (
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0, rotate: 180 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="fixed bottom-8 right-8 z-40"
          >
            <motion.a
              href="/create"
              className="flex items-center justify-center w-16 h-16 bg-red-600 text-white border-2 border-gray-900 dark:border-white shadow-[6px_6px_0px_rgba(0,0,0,0.4)]"
              style={{ transform: 'skew(-2deg)' }}
              whileHover={{
                scale: 1.15,
                rotate: 5,
                boxShadow: '8px_8px_0px_rgba(0,0,0,0.6)'
              }}
              whileTap={{ scale: 0.9 }}
            >
              <span className="text-3xl font-black">+</span>
            </motion.a>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}