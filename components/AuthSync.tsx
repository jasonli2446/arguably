"use client"

import { useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { ensureUserProfile } from "@/lib/actions/user"

export default function AuthSync() {
  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        ensureUserProfile()
      }
    })
  }, [])

  return null
}
