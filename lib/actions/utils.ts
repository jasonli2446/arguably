"use server"

import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"

/**
 * Require authenticated user. Returns the Supabase user object.
 * Throws if not authenticated.
 */
export async function requireAuth() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")
  return user
}

/**
 * Require that the current user is the host or moderator of the given session.
 * Returns both the user and session objects.
 */
export async function requireHostOrModerator(sessionId: string) {
  const user = await requireAuth()

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  })
  if (!session) throw new Error("Session not found")

  if (session.host_id !== user.id && session.moderator_id !== user.id) {
    throw new Error("Not authorized")
  }

  return { user, session }
}

/**
 * Verify that the authenticated user is an active participant in the session.
 * Returns the user object.
 */
export async function requireParticipant(sessionId: string) {
  const user = await requireAuth()

  const participation = await prisma.participatesIn.findUnique({
    where: {
      user_id_session_id: {
        user_id: user.id,
        session_id: sessionId,
      },
    },
  })

  if (!participation || participation.left_at) {
    throw new Error("Not a participant in this session")
  }

  return user
}
