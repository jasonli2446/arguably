"use server"

import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"

export async function ensureUserProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const existing = await prisma.user.findUnique({
    where: { id: user.id },
  })

  if (existing) return existing

  const email = user.email ?? ""
  const username = email.split("@")[0] || `user-${user.id.slice(0, 8)}`

  // Handle potential username collision
  let finalUsername = username
  let suffix = 1
  while (await prisma.user.findUnique({ where: { username: finalUsername } })) {
    finalUsername = `${username}-${suffix}`
    suffix++
  }

  const newUser = await prisma.user.create({
    data: {
      id: user.id,
      username: finalUsername,
      email: email || null,
    },
  })

  return newUser
}
