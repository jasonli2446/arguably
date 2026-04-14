"use server"

import { prisma } from "@/lib/prisma"
import { requireAuth, requireHostOrModerator } from "@/lib/actions/utils"
import { SessionRole, SessionStatus } from "@/lib/generated/prisma"

export async function joinQueue(sessionId: string) {
  const user = await requireAuth()

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true },
  })
  if (!session) throw new Error("Session not found")
  if (session.status !== SessionStatus.LIVE) throw new Error("Session is not live")

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

  return await prisma.audienceQueue.create({
    data: {
      session_id: sessionId,
      user_id: user.id,
    },
  })
}

export async function leaveQueue(sessionId: string) {
  const user = await requireAuth()

  await prisma.audienceQueue.delete({
    where: {
      session_id_user_id: {
        session_id: sessionId,
        user_id: user.id,
      },
    },
  })
}

export async function getQueue(sessionId: string) {
  return await prisma.audienceQueue.findMany({
    where: { session_id: sessionId },
    orderBy: { joined_queue: "asc" },
    include: {
      user: { select: { id: true, username: true, realname: true } },
    },
  })
}

export async function promoteFromQueue(sessionId: string, userId?: string) {
  await requireHostOrModerator(sessionId)

  return await prisma.$transaction(async (tx) => {
    // Find the user to promote: specific user or FIFO head
    const queueEntry = userId
      ? await tx.audienceQueue.findUnique({
          where: { session_id_user_id: { session_id: sessionId, user_id: userId } },
        })
      : await tx.audienceQueue.findFirst({
          where: { session_id: sessionId },
          orderBy: { joined_queue: "asc" },
        })

    if (!queueEntry) throw new Error("No one in the queue")

    const targetUserId = queueEntry.user_id

    // Update role to DEBATER
    await tx.participatesIn.update({
      where: {
        user_id_session_id: {
          user_id: targetUserId,
          session_id: sessionId,
        },
      },
      data: { session_role: SessionRole.DEBATER },
    })

    // Remove from queue
    await tx.audienceQueue.delete({
      where: {
        session_id_user_id: {
          session_id: sessionId,
          user_id: targetUserId,
        },
      },
    })

    // Log role transition
    await tx.roleHistory.create({
      data: {
        session_id: sessionId,
        user_id: targetUserId,
        old_role: SessionRole.AUDIENCE,
        new_role: SessionRole.DEBATER,
        reason: "Promoted from queue",
      },
    })

    return { promotedUserId: targetUserId }
  })
}
