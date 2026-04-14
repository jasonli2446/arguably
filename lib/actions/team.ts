"use server"

import { prisma } from "@/lib/prisma"
import { requireHostOrModerator } from "@/lib/actions/utils"
import { SessionType } from "@/lib/generated/prisma"

export async function assignTeam(
  sessionId: string,
  userId: string,
  team: string
) {
  const { session } = await requireHostOrModerator(sessionId)

  if (session.type !== SessionType.TEAM) {
    throw new Error("Team assignments are only for TEAM format sessions")
  }

  if (team !== "proponent" && team !== "opponent") {
    throw new Error("Team must be 'proponent' or 'opponent'")
  }

  return await prisma.teamAssignment.upsert({
    where: {
      session_id_user_id: {
        session_id: sessionId,
        user_id: userId,
      },
    },
    create: {
      session_id: sessionId,
      user_id: userId,
      team,
    },
    update: { team },
  })
}

export async function getTeamAssignments(sessionId: string) {
  return await prisma.teamAssignment.findMany({
    where: { session_id: sessionId },
    include: {
      user: { select: { id: true, username: true, realname: true } },
    },
    orderBy: { assigned_at: "asc" },
  })
}

export async function removeFromTeam(sessionId: string, userId: string) {
  await requireHostOrModerator(sessionId)

  await prisma.teamAssignment.delete({
    where: {
      session_id_user_id: {
        session_id: sessionId,
        user_id: userId,
      },
    },
  })
}
