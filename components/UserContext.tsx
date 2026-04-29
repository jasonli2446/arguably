"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { createClient } from "@/lib/supabase/client"
import { ensureUserProfile } from "@/lib/actions/user"

interface UserContextValue {
  role: string | null
}

const UserContext = createContext<UserContextValue>({ role: null })

/** Returns the current user's platform role as loaded from the profile context. */
export function useUserRole() {
  return useContext(UserContext).role
}

/** Provides the authenticated user's role and keeps it in sync with Supabase auth events. */
export function UserProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()

    const syncProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const profile = await ensureUserProfile()
        setRole(profile?.role ?? null)
      } else {
        setRole(null)
      }
    }

    syncProfile()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        ensureUserProfile().then((profile) => {
          setRole(profile?.role ?? null)
        })
      } else if (event === "SIGNED_OUT") {
        setRole(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  return (
    <UserContext value={{ role }}>
      {children}
    </UserContext>
  )
}
