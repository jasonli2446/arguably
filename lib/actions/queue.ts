"use server"

import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"
import { SessionRole, VoteType } from "@/lib/generated/prisma"
import type { PrismaClient } from "@/lib/generated/prisma"

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]

// ---------------------------------------------------------------------------
// Internal helpers (NOT server actions — called within transactions)
// ---------------------------------------------------------------------------

/** Pop the front of the queue (oldest added_at), promote to DEBATER, update DebateState. */
async function doPromoteFromQueue(
  tx: TransactionClient,
  sessionId: string
): Promise<{ userId: string; displayName: string } | null> {
  const front = await tx.audienceQueue.findFirst({
    where: { session_id: sessionId },
    orderBy: [{ added_at: "asc" }, { id: "asc" }],
    include: { user: { select: { id: true, username: true, realname: true } } },
  })
  if (!front) return null

  // Remove from queue
  await tx.audienceQueue.delete({ where: { id: front.id } })

  // Update ParticipatesIn to DEBATER
  await tx.participatesIn.update({
    where: {
      user_id_session_id: {
        user_id: front.user_id,
        session_id: sessionId,
      },
    },
    data: { session_role: SessionRole.DEBATER },
  })

  const displayName = front.user.realname || front.user.username
  const promoted = { userId: front.user_id, displayName }

  // Append to DebateState.debater_order if debate is active
  const state = await tx.debateState.findUnique({
    where: { session_id: sessionId },
  })
  if (state) {
    const order = state.debater_order as { userId: string; displayName: string }[]
    order.push(promoted)
    await tx.debateState.update({
      where: { session_id: sessionId },
      data: { debater_order: order },
    })
  }

  return promoted
}

/** Delete all votes cast by and targeting a user in a session. */
async function cleanupUserVotes(
  tx: TransactionClient,
  sessionId: string,
  userId: string
) {
  await tx.vote.deleteMany({
    where: {
      session_id: sessionId,
      OR: [{ voter_id: userId }, { target_user_id: userId }],
    },
  })
}

// ---------------------------------------------------------------------------
// Exported server actions
// ---------------------------------------------------------------------------

export async function joinQueue(sessionId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  // Verify user is AUDIENCE in this session
  const participation = await prisma.participatesIn.findUnique({
    where: {
      user_id_session_id: { user_id: user.id, session_id: sessionId },
    },
  })
  if (!participation || participation.left_at) {
    throw new Error("Not a participant in this session")
  }
  if (
    participation.session_role !== SessionRole.AUDIENCE
  ) {
    throw new Error("Only audience members can join the queue")
  }

  // Check session not ended
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true },
  })
  if (!session || session.status === "ENDED") {
    throw new Error("Session has ended")
  }

  await prisma.audienceQueue.create({
    data: {
      session_id: sessionId,
      user_id: user.id,
    },
  })
}

export async function leaveQueue(sessionId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  await prisma.$transaction(async (tx) => {
    await tx.audienceQueue.deleteMany({
      where: { session_id: sessionId, user_id: user.id },
    })
    // Also clean up any votes this user cast
    await tx.vote.deleteMany({
      where: { session_id: sessionId, voter_id: user.id },
    })
  })
}

export async function getQueue(sessionId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const entries = await prisma.audienceQueue.findMany({
    where: { session_id: sessionId },
    orderBy: [{ added_at: "asc" }, { id: "asc" }],
    include: {
      user: { select: { id: true, username: true, realname: true } },
    },
  })

  return entries.map((entry, index) => ({
    id: entry.id,
    userId: entry.user_id,
    rank: index + 1,
    displayName: entry.user.realname || entry.user.username,
    addedAt: entry.added_at.toISOString(),
  }))
}

export async function promoteFromQueue(sessionId: string) {
  // Require moderator/host
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { host_id: true, moderator_id: true },
  })
  if (!session) throw new Error("Session not found")
  if (session.host_id !== user.id && session.moderator_id !== user.id) {
    throw new Error("Only moderator or host can promote from queue")
  }

  return prisma.$transaction(async (tx) => {
    return doPromoteFromQueue(tx, sessionId)
  })
}

export async function castKickVote(sessionId: string, targetUserId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")
  if (user.id === targetUserId) throw new Error("Cannot vote to kick yourself")

  return prisma.$transaction(async (tx) => {
    // Verify voter is AUDIENCE
    const voterPart = await tx.participatesIn.findUnique({
      where: {
        user_id_session_id: { user_id: user.id, session_id: sessionId },
      },
    })
    if (!voterPart || voterPart.left_at || voterPart.session_role !== SessionRole.AUDIENCE) {
      throw new Error("Only audience members can vote to kick")
    }

    // Verify target is DEBATER and not HOST
    const targetPart = await tx.participatesIn.findUnique({
      where: {
        user_id_session_id: { user_id: targetUserId, session_id: sessionId },
      },
    })
    if (!targetPart || targetPart.left_at || targetPart.session_role !== SessionRole.DEBATER) {
      throw new Error("Target must be an active debater")
    }

    // Get session for threshold
    const session = await tx.session.findUnique({
      where: { id: sessionId },
      select: { kick_threshold: true, host_id: true },
    })
    if (!session) throw new Error("Session not found")
    if (targetUserId === session.host_id) throw new Error("Cannot vote to kick the host")

    // Create vote (unique constraint prevents double-voting)
    await tx.vote.create({
      data: {
        session_id: sessionId,
        voter_id: user.id,
        target_user_id: targetUserId,
        vote_type: VoteType.KICK,
      },
    })

    // Count votes and audience
    const voteCount = await tx.vote.count({
      where: {
        session_id: sessionId,
        target_user_id: targetUserId,
        vote_type: VoteType.KICK,
      },
    })
    const audienceCount = await tx.participatesIn.count({
      where: {
        session_id: sessionId,
        left_at: null,
        session_role: SessionRole.AUDIENCE,
      },
    })

    const requiredVotes = Math.ceil((audienceCount * session.kick_threshold) / 100)
    const kicked = voteCount >= requiredVotes && requiredVotes > 0

    if (kicked) {
      // Kick the target
      await tx.participatesIn.update({
        where: {
          user_id_session_id: { user_id: targetUserId, session_id: sessionId },
        },
        data: { left_at: new Date() },
      })

      // Remove target from debater_order
      const state = await tx.debateState.findUnique({
        where: { session_id: sessionId },
      })
      if (state) {
        const order = state.debater_order as { userId: string; displayName: string }[]
        const newOrder = order.filter((d) => d.userId !== targetUserId)
        // Adjust current_index if needed
        let newIndex = state.current_index
        const removedIndex = order.findIndex((d) => d.userId === targetUserId)
        if (removedIndex < state.current_index) {
          newIndex = Math.max(0, newIndex - 1)
        } else if (removedIndex === state.current_index) {
          newIndex = newOrder.length > 0 ? newIndex % newOrder.length : 0
        }
        await tx.debateState.update({
          where: { session_id: sessionId },
          data: { debater_order: newOrder, current_index: newIndex },
        })
      }

      // Clean up all votes for this target
      await tx.vote.deleteMany({
        where: {
          session_id: sessionId,
          target_user_id: targetUserId,
          vote_type: VoteType.KICK,
        },
      })

      // Auto-promote from queue
      await doPromoteFromQueue(tx, sessionId)
    }

    return { kicked, voteCount, requiredVotes }
  })
}

export async function removeKickVote(sessionId: string, targetUserId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  await prisma.vote.deleteMany({
    where: {
      session_id: sessionId,
      voter_id: user.id,
      target_user_id: targetUserId,
      vote_type: VoteType.KICK,
    },
  })
}

export async function getKickVotes(sessionId: string, targetUserId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const [voteCount, audienceCount, userVote, session] = await Promise.all([
    prisma.vote.count({
      where: {
        session_id: sessionId,
        target_user_id: targetUserId,
        vote_type: VoteType.KICK,
      },
    }),
    prisma.participatesIn.count({
      where: {
        session_id: sessionId,
        left_at: null,
        session_role: SessionRole.AUDIENCE,
      },
    }),
    prisma.vote.findFirst({
      where: {
        session_id: sessionId,
        voter_id: user.id,
        target_user_id: targetUserId,
        vote_type: VoteType.KICK,
      },
    }),
    prisma.session.findUnique({
      where: { id: sessionId },
      select: { kick_threshold: true },
    }),
  ])

  const threshold = session?.kick_threshold ?? 50
  const requiredVotes = Math.ceil((audienceCount * threshold) / 100)

  return {
    voteCount,
    requiredVotes,
    userHasVoted: !!userVote,
  }
}

// Re-export internal helpers for use by other server action modules
export { doPromoteFromQueue, cleanupUserVotes }
