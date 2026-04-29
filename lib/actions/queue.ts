"use server"

import { prisma } from "@/lib/prisma"
import { requireAuth, requireHostOrModerator } from "@/lib/actions/utils"
import { SessionRole, SessionStatus, VoteType } from "@/lib/generated/prisma"
import type { PrismaClient } from "@/lib/generated/prisma"

/** Prisma transaction client accepted by queue helper functions. */
export type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]

// ---------------------------------------------------------------------------
// Internal helpers (NOT server actions — called within transactions)
// ---------------------------------------------------------------------------

/** Pop the front of the queue (oldest joined_queue), promote to DEBATER, update DebateState. */
async function doPromoteFromQueue(
  tx: TransactionClient,
  sessionId: string
): Promise<{ userId: string; displayName: string } | null> {
  const front = await tx.audienceQueue.findFirst({
    where: { session_id: sessionId },
    orderBy: [{ joined_queue: "asc" }, { id: "asc" }],
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

  // Assign team (queue promotions are challengers/opponents by default)
  await tx.teamAssignment.upsert({
    where: { session_id_user_id: { session_id: sessionId, user_id: front.user_id } },
    create: { session_id: sessionId, user_id: front.user_id, team: 'opponent' },
    update: { team: 'opponent' },
  })

  // Log role transition
  await tx.roleHistory.create({
    data: {
      session_id: sessionId,
      user_id: front.user_id,
      old_role: SessionRole.AUDIENCE,
      new_role: SessionRole.DEBATER,
      reason: "Promoted from queue",
    },
  })

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

/** Adds the authenticated audience participant to the session queue. */
export async function joinQueue(sessionId: string) {
  const user = await requireAuth()

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true },
  })
  if (!session) throw new Error("Session not found")
  if (session.status !== SessionStatus.LIVE && session.status !== SessionStatus.WAITING) {
    throw new Error("Session is not active")
  }

  // Verify user is an audience member
  const participation = await prisma.participatesIn.findUnique({
    where: {
      user_id_session_id: { user_id: user.id, session_id: sessionId },
    },
  })
  if (!participation || participation.left_at) {
    throw new Error("Not a participant in this session")
  }
  if (participation.session_role !== SessionRole.AUDIENCE) {
    throw new Error("Only audience members can join the queue")
  }

  // Prevent duplicate queue entries
  const existing = await prisma.audienceQueue.findUnique({
    where: { session_id_user_id: { session_id: sessionId, user_id: user.id } },
  })
  if (existing) {
    throw new Error("Already in the queue")
  }

  return await prisma.audienceQueue.create({
    data: {
      session_id: sessionId,
      user_id: user.id,
    },
  })
}

/** Removes the authenticated user from the queue and clears their cast votes. */
export async function leaveQueue(sessionId: string) {
  const user = await requireAuth()

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

/** Returns the ordered audience queue with display names and 1-based ranks. */
export async function getQueue(sessionId: string) {
  const user = await requireAuth()
  if (!user) throw new Error("Not authenticated")

  const entries = await prisma.audienceQueue.findMany({
    where: { session_id: sessionId },
    orderBy: [{ joined_queue: "asc" }, { id: "asc" }],
    include: {
      user: { select: { id: true, username: true, realname: true } },
    },
  })

  return entries.map((entry, index) => ({
    id: entry.id,
    userId: entry.user_id,
    rank: index + 1,
    displayName: entry.user.realname || entry.user.username,
    addedAt: entry.joined_queue.toISOString(),
  }))
}

/** Promotes a queued audience member to debater, optionally choosing a specific user. */
export async function promoteFromQueue(sessionId: string, userId?: string) {
  await requireHostOrModerator(sessionId)

  return prisma.$transaction(async (tx) => {
    if (userId) {
      // Promote specific user
      const queueEntry = await tx.audienceQueue.findUnique({
        where: { session_id_user_id: { session_id: sessionId, user_id: userId } },
      })
      if (!queueEntry) throw new Error("No one in the queue")

      await tx.participatesIn.update({
        where: {
          user_id_session_id: {
            user_id: userId,
            session_id: sessionId,
          },
        },
        data: { session_role: SessionRole.DEBATER },
      })
      await tx.audienceQueue.delete({
        where: {
          session_id_user_id: {
            session_id: sessionId,
            user_id: userId,
          },
        },
      })
      await tx.teamAssignment.upsert({
        where: { session_id_user_id: { session_id: sessionId, user_id: userId } },
        create: { session_id: sessionId, user_id: userId, team: 'opponent' },
        update: { team: 'opponent' },
      })
      await tx.roleHistory.create({
        data: {
          session_id: sessionId,
          user_id: userId,
          old_role: SessionRole.AUDIENCE,
          new_role: SessionRole.DEBATER,
          reason: "Promoted from queue",
        },
      })
      return { promotedUserId: userId }
    }

    // FIFO promote
    return doPromoteFromQueue(tx, sessionId).then((result) => {
      if (!result) throw new Error("No one in the queue")
      return { promotedUserId: result.userId }
    })
  })
}

/** Casts an audience kick vote and kicks the target if the configured threshold is reached. */
export async function castKickVote(sessionId: string, targetUserId: string) {
  const user = await requireAuth()
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

      // Log role transition
      await tx.roleHistory.create({
        data: {
          session_id: sessionId,
          user_id: targetUserId,
          old_role: SessionRole.DEBATER,
          new_role: SessionRole.AUDIENCE,
          reason: "Kicked by audience vote",
        },
      })

      // Auto-promote from queue
      await doPromoteFromQueue(tx, sessionId)
    }

    return { kicked, voteCount, requiredVotes }
  })
}

/** Removes the authenticated user's kick vote against a target. */
export async function removeKickVote(sessionId: string, targetUserId: string) {
  const user = await requireAuth()

  await prisma.vote.deleteMany({
    where: {
      session_id: sessionId,
      voter_id: user.id,
      target_user_id: targetUserId,
      vote_type: VoteType.KICK,
    },
  })
}

/** Returns current kick-vote tally, threshold, and caller vote state for a target. */
export async function getKickVotes(sessionId: string, targetUserId: string) {
  const user = await requireAuth()
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
