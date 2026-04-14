"use server"

import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"

async function requireAuth() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")
  return user
}

async function requireModerator(sessionId: string) {
  const user = await requireAuth()

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
  await requireAuth()

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
    format: state.format,
    phase: state.phase,
    version: state.version,
  }
}

export async function startDebate(
  sessionId: string,
  debaters: { userId: string; displayName: string }[],
  turnLength: number,
  format?: string
) {
  const { session } = await requireModerator(sessionId)

  // Input validation
  if (turnLength < 1 || turnLength > 1800) {
    throw new Error("Turn length must be between 1 and 1800 seconds")
  }

  if (debaters.length < 2) {
    throw new Error("At least 2 debaters required")
  }

  // Validate debater IDs exist as participants in this session
  const debaterIds = debaters.map((d) => d.userId)
  const participants = await prisma.participatesIn.findMany({
    where: {
      session_id: sessionId,
      user_id: { in: debaterIds },
      left_at: null,
    },
  })
  if (participants.length !== debaterIds.length) {
    throw new Error("One or more debater IDs are not active participants")
  }

  // Format-specific validation
  const debateFormat = format || session.type
  if (debateFormat === "ONE_ON_ONE" && debaters.length !== 2) {
    throw new Error("One-on-One format requires exactly 2 debaters")
  }
  if (debateFormat === "PANEL" && (debaters.length < 3 || debaters.length > 6)) {
    throw new Error("Panel format requires 3-6 debaters")
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
      format: session.type,
      phase: "ACTIVE",
      version: 0,
    },
    update: {
      debater_order: debaters,
      current_index: 0,
      turn_length: turnLength,
      turn_ends_at: now + turnLength * 1000,
      is_paused: false,
      paused_time_remaining: turnLength,
      format: session.type,
      phase: "ACTIVE",
      version: { increment: 1 },
    },
  })
}

export async function advanceTurn(sessionId: string) {
  await requireModerator(sessionId)

  const state = await prisma.debateState.findUnique({
    where: { session_id: sessionId },
  })
  if (!state) throw new Error("No active debate")

  const debaterOrder = state.debater_order as { userId: string; displayName: string }[]
  const debaterCount = debaterOrder.length

  const now = Date.now()
  await prisma.debateState.update({
    where: { session_id: sessionId },
    data: {
      current_index: (state.current_index + 1) % debaterCount,
      turn_ends_at: now + state.turn_length * 1000,
      is_paused: false,
      paused_time_remaining: state.turn_length,
      phase: "ACTIVE",
      version: { increment: 1 },
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
      phase: "PAUSED",
      version: { increment: 1 },
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
      phase: "ACTIVE",
      version: { increment: 1 },
    },
  })
}

export async function endDebate(sessionId: string) {
  await requireModerator(sessionId)
  await prisma.debateState
    .update({
      where: { session_id: sessionId },
      data: { phase: "ENDED", version: { increment: 1 } },
    })
    .catch(() => {})
}
