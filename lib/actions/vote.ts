"use server"

import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/actions/utils"
import { SessionStatus, VoteType } from "@/lib/generated/prisma"

/** Casts a typed vote against another active participant in a live session. */
export async function castVote(
  sessionId: string,
  targetUserId: string,
  voteType: VoteType
) {
  const user = await requireAuth()

  if (user.id === targetUserId) throw new Error("Cannot vote for yourself")

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true },
  })
  if (!session) throw new Error("Session not found")
  if (session.status !== SessionStatus.LIVE) throw new Error("Session is not live")

  // Verify voter is an active participant
  const participation = await prisma.participatesIn.findUnique({
    where: {
      user_id_session_id: { user_id: user.id, session_id: sessionId },
    },
  })
  if (!participation || participation.left_at) {
    throw new Error("Not a participant in this session")
  }

  return await prisma.vote.upsert({
    where: {
      session_id_voter_id_target_user_id_vote_type: {
        session_id: sessionId,
        voter_id: user.id,
        target_user_id: targetUserId,
        vote_type: voteType,
      },
    },
    create: {
      session_id: sessionId,
      voter_id: user.id,
      target_user_id: targetUserId,
      vote_type: voteType,
    },
    update: {},
  })
}

/** Removes the authenticated user's vote for the target and vote type. */
export async function retractVote(
  sessionId: string,
  targetUserId: string,
  voteType: VoteType
) {
  const user = await requireAuth()

  await prisma.vote.delete({
    where: {
      session_id_voter_id_target_user_id_vote_type: {
        session_id: sessionId,
        voter_id: user.id,
        target_user_id: targetUserId,
        vote_type: voteType,
      },
    },
  })
}

/** Counts votes of one type against a target user in a session. */
export async function getVoteCounts(
  sessionId: string,
  targetUserId: string,
  voteType: VoteType
) {
  const count = await prisma.vote.count({
    where: {
      session_id: sessionId,
      target_user_id: targetUserId,
      vote_type: voteType,
    },
  })

  return { count }
}
