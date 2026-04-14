"use server"

import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"
import { SessionRole, SessionType } from "@/lib/generated/prisma"
import { requireHostOrModerator } from "@/lib/actions/utils"
import { doPromoteFromQueue } from "@/lib/actions/queue"

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
    format: state.format,
    phase: state.phase,
    version: state.version,
  }
}

export async function startDebate(
  sessionId: string,
  debaters: { userId: string; displayName: string }[],
  turnLength: number
) {
  const { session } = await requireHostOrModerator(sessionId)
  if (debaters.length < 2) throw new Error("At least 2 debaters required")
  if (turnLength < 1) throw new Error("Turn length must be at least 1 second")
  if (turnLength > 1800) throw new Error("Turn length cannot exceed 30 minutes (1800 seconds)")

  if (session.type === SessionType.EXPERT_VS_CROWD) {
    // Expert vs Crowd: accept 1 debater (expert), auto-promote first queue member
    if (debaters.length !== 1) throw new Error("Expert vs. Crowd requires exactly 1 expert")

    // Validate the expert is an active participant
    const participation = await prisma.participatesIn.findMany({
      where: {
        session_id: sessionId,
        left_at: null,
        user_id: { in: debaters.map((d) => d.userId) },
      },
      select: { user_id: true },
    })
    const participantIds = new Set(participation.map((p: { user_id: string }) => p.user_id))
    for (const debater of debaters) {
      if (!participantIds.has(debater.userId)) {
        throw new Error(`Debater ${debater.userId} is not an active participant in this session`)
      }
    }

    return prisma.$transaction(async (tx) => {
      // Pop first queue member as challenger
      const challenger = await doPromoteFromQueue(tx, sessionId)
      if (!challenger) throw new Error("No one in the queue to challenge the expert")

      const debaterOrder = [debaters[0], challenger]
      const now = Date.now()
      await tx.debateState.upsert({
        where: { session_id: sessionId },
        create: {
          session_id: sessionId,
          debater_order: debaterOrder,
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
          debater_order: debaterOrder,
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
    })
  }

  // All other formats: require at least 2 debaters
  if (debaters.length < 2) throw new Error("At least 2 debaters required")

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
  const { session } = await requireHostOrModerator(sessionId)

  const state = await prisma.debateState.findUnique({
    where: { session_id: sessionId },
  })
  if (!state) throw new Error("No active debate")

  const order = state.debater_order as { userId: string; displayName: string }[]

  if (session.type === SessionType.EXPERT_VS_CROWD && state.current_index === 1) {
    // Challenger just finished — rotate challenger from queue
    return prisma.$transaction(async (tx) => {
      const oldChallenger = order[1]

      // Demote old challenger back to AUDIENCE
      if (oldChallenger) {
        await tx.participatesIn.update({
          where: {
            user_id_session_id: {
              user_id: oldChallenger.userId,
              session_id: sessionId,
            },
          },
          data: { session_role: SessionRole.AUDIENCE },
        })
      }

      // Promote next from queue
      const newChallenger = await doPromoteFromQueue(tx, sessionId)

      if (!newChallenger) {
        // No one in queue — pause debate
        const remaining = state.turn_ends_at
          ? Math.max(0, (state.turn_ends_at - Date.now()) / 1000)
          : state.turn_length
        await tx.debateState.update({
          where: { session_id: sessionId },
          data: {
            // Keep expert at index 0, remove old challenger
            debater_order: [order[0]],
            current_index: 0,
            is_paused: true,
            turn_ends_at: null,
            paused_time_remaining: remaining,
          },
        })
        return
      }

      // doPromoteFromQueue appends to debater_order, but we need to replace index 1
      // So we manually set the order to [expert, newChallenger]
      const now = Date.now()
      await tx.debateState.update({
        where: { session_id: sessionId },
        data: {
          debater_order: [order[0], newChallenger],
          current_index: 0,
          turn_ends_at: now + state.turn_length * 1000,
          is_paused: false,
          paused_time_remaining: state.turn_length,
        },
      })
    })
  }

  // Standard turn advancement for all formats
  const now = Date.now()
  await prisma.debateState.update({
    where: { session_id: sessionId },
    data: {
      current_index: (state.current_index + 1) % order.length,
      turn_ends_at: now + state.turn_length * 1000,
      is_paused: false,
      paused_time_remaining: state.turn_length,
      phase: "ACTIVE",
      version: { increment: 1 },
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

  const order = state.debater_order as { userId: string; displayName: string }[]

  // Check if this is Expert vs Crowd and challenger's turn ended
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { type: true },
  })

  if (session?.type === SessionType.EXPERT_VS_CROWD && state.current_index === 1) {
    // Challenger turn expired — rotate via transaction
    return prisma.$transaction(async (tx) => {
      // Atomic guard: only proceed if state hasn't changed
      const current = await tx.debateState.findUnique({
        where: { session_id: sessionId },
      })
      if (
        !current ||
        current.current_index !== state.current_index ||
        current.is_paused
      ) {
        return // Already advanced by someone else
      }

      const oldChallenger = order[1]
      if (oldChallenger) {
        await tx.participatesIn.update({
          where: {
            user_id_session_id: {
              user_id: oldChallenger.userId,
              session_id: sessionId,
            },
          },
          data: { session_role: SessionRole.AUDIENCE },
        })
      }

      const newChallenger = await doPromoteFromQueue(tx, sessionId)

      if (!newChallenger) {
        await tx.debateState.update({
          where: { session_id: sessionId },
          data: {
            debater_order: [order[0]],
            current_index: 0,
            is_paused: true,
            turn_ends_at: null,
            paused_time_remaining: state.turn_length,
          },
        })
        return
      }

      const now = Date.now()
      await tx.debateState.update({
        where: { session_id: sessionId },
        data: {
          debater_order: [order[0], newChallenger],
          current_index: 0,
          turn_ends_at: now + state.turn_length * 1000,
          paused_time_remaining: state.turn_length,
        },
      })
    })
  }

  // Standard auto-advance for all other formats
  const now = Date.now()
  await prisma.debateState.updateMany({
    where: {
      session_id: sessionId,
      current_index: state.current_index,
      is_paused: false,
    },
    data: {
      current_index: (state.current_index + 1) % order.length,
      turn_ends_at: now + state.turn_length * 1000,
      paused_time_remaining: state.turn_length,
    },
  })
}

export async function pauseDebate(sessionId: string) {
  await requireHostOrModerator(sessionId)

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
  await requireHostOrModerator(sessionId)

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

export async function extendTurn(sessionId: string, extraSeconds: number) {
  await requireHostOrModerator(sessionId)

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
  await requireHostOrModerator(sessionId)
  await prisma.debateState
    .update({
      where: { session_id: sessionId },
      data: { phase: "ENDED", version: { increment: 1 } },
    })
    .catch(() => {})
}
