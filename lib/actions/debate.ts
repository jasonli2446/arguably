"use server"

import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"

async function requireModerator(sessionId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  })
  if (!session) throw new Error("Session not found")

  const allowed =
    session.moderator_id === user.id || session.host_id === user.id
  if (!allowed) throw new Error("Not authorized")

  return { user, session }
}

export async function getDebateState(sessionId: string) {
  // Auth check: require authenticated user
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const state = await prisma.debateState.findUnique({
    where: { session_id: sessionId },
  })
  if (!state) return null
  return {
    session_id: state.session_id,
    debater_order: state.debater_order as {
      userId: string
      displayName: string
    }[],
    current_index: state.current_index,
    turn_length: state.turn_length,
    turn_ends_at: state.turn_ends_at,
    is_paused: state.is_paused,
    paused_time_remaining: state.paused_time_remaining,
  }
}

export async function startDebate(
  sessionId: string,
  debaters: { userId: string; displayName: string }[],
  turnLength: number
) {
  await requireModerator(sessionId)
  if (debaters.length !== 2) throw new Error("Exactly 2 debaters required")
  if (turnLength < 1) throw new Error("Turn length must be at least 1 second")
  if (turnLength > 1800) throw new Error("Turn length cannot exceed 30 minutes (1800 seconds)")

  // Validate debater IDs are active participants in the session
  const participants = await prisma.participatesIn.findMany({
    where: {
      session_id: sessionId,
      left_at: null,
      user_id: { in: debaters.map((d) => d.userId) },
    },
    select: { user_id: true },
  })
  const participantIds = new Set(participants.map((p: { user_id: string }) => p.user_id))
  for (const debater of debaters) {
    if (!participantIds.has(debater.userId)) {
      throw new Error(`Debater ${debater.userId} is not an active participant in this session`)
    }
  }

  const now = Date.now()
  await prisma.debateState.upsert({
    where: { session_id: sessionId },
    create: {
      session_id: sessionId,
      debater_order: debaters,
      current_index: 0,
      turn_length: turnLength,
      turn_ends_at: now + turnLength * 1000,
      is_paused: false,
      paused_time_remaining: turnLength,
    },
    update: {
      debater_order: debaters,
      current_index: 0,
      turn_length: turnLength,
      turn_ends_at: now + turnLength * 1000,
      is_paused: false,
      paused_time_remaining: turnLength,
    },
  })
}

export async function advanceTurn(sessionId: string) {
  await requireModerator(sessionId)

  const state = await prisma.debateState.findUnique({
    where: { session_id: sessionId },
  })
  if (!state) throw new Error("No active debate")

  const now = Date.now()
  await prisma.debateState.update({
    where: { session_id: sessionId },
    data: {
      current_index: (state.current_index + 1) % 2,
      turn_ends_at: now + state.turn_length * 1000,
      is_paused: false,
      paused_time_remaining: state.turn_length,
    },
  })
}

export async function advanceTurnIfExpired(sessionId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  // Verify user is an active participant in this session
  const participation = await prisma.participatesIn.findUnique({
    where: { user_id_session_id: { user_id: user.id, session_id: sessionId } },
  })
  if (!participation || participation.left_at !== null) return

  const state = await prisma.debateState.findUnique({
    where: { session_id: sessionId },
  })
  if (!state || state.is_paused || !state.turn_ends_at) return
  if (Date.now() < state.turn_ends_at - 1000) return

  const now = Date.now()
  // Atomic guard: only advance if current_index hasn't changed (prevents double-advance)
  await prisma.debateState.updateMany({
    where: {
      session_id: sessionId,
      current_index: state.current_index,
      is_paused: false,
    },
    data: {
      current_index: (state.current_index + 1) % 2,
      turn_ends_at: now + state.turn_length * 1000,
      paused_time_remaining: state.turn_length,
    },
  })
}

export async function pauseDebate(sessionId: string) {
  await requireModerator(sessionId)

  const state = await prisma.debateState.findUnique({
    where: { session_id: sessionId },
  })
  if (!state) throw new Error("No active debate")
  if (state.is_paused) throw new Error("Already paused")

  const remaining = state.turn_ends_at
    ? Math.max(0, (state.turn_ends_at - Date.now()) / 1000)
    : 0

  await prisma.debateState.update({
    where: { session_id: sessionId },
    data: {
      is_paused: true,
      turn_ends_at: null,
      paused_time_remaining: remaining,
    },
  })
}

export async function resumeDebate(sessionId: string) {
  await requireModerator(sessionId)

  const state = await prisma.debateState.findUnique({
    where: { session_id: sessionId },
  })
  if (!state) throw new Error("No active debate")
  if (!state.is_paused) throw new Error("Not paused")

  const now = Date.now()
  await prisma.debateState.update({
    where: { session_id: sessionId },
    data: {
      is_paused: false,
      turn_ends_at: now + state.paused_time_remaining * 1000,
    },
  })
}

export async function extendTurn(sessionId: string, extraSeconds: number) {
  await requireModerator(sessionId)

  const state = await prisma.debateState.findUnique({
    where: { session_id: sessionId },
  })
  if (!state) throw new Error("No active debate")

  if (state.is_paused) {
    await prisma.debateState.update({
      where: { session_id: sessionId },
      data: {
        paused_time_remaining: state.paused_time_remaining + extraSeconds,
      },
    })
  } else {
    if (!state.turn_ends_at) throw new Error("No active turn")
    await prisma.debateState.update({
      where: { session_id: sessionId },
      data: {
        turn_ends_at: state.turn_ends_at + extraSeconds * 1000,
      },
    })
  }
}

export async function endDebate(sessionId: string) {
  await requireModerator(sessionId)
  await prisma.debateState
    .delete({ where: { session_id: sessionId } })
    .catch(() => {})
}
