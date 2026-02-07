"use server"

import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"
import { generateRoomCode } from "@/lib/utils"
import { redirect } from "next/navigation"
import { SessionStatus, SessionType } from "@/lib/generated/prisma"

export async function createSession(formData: {
  name: string
  type: SessionType
  maxParticipants: number
  turnLength: number
  description?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  if (!formData.name.trim()) throw new Error("Room name is required")

  // Generate a unique room code
  let code = generateRoomCode()
  let attempts = 0
  while (await prisma.session.findUnique({ where: { code } })) {
    code = generateRoomCode()
    attempts++
    if (attempts > 10) throw new Error("Could not generate unique room code")
  }

  const session = await prisma.session.create({
    data: {
      code,
      name: formData.name.trim(),
      description: formData.description?.trim() || null,
      type: formData.type,
      max_participants: formData.maxParticipants,
      turn_length: formData.turnLength,
      moderator_id: user.id,
      hosts: {
        create: { creator_id: user.id },
      },
      participatesIns: {
        create: {
          participant_id: user.id,
          role: "CREATOR",
        },
      },
    },
  })

  redirect(`/room/${session.code}`)
}

export async function listSessions(filters?: {
  search?: string
  type?: SessionType
  status?: SessionStatus
}) {
  const where: Record<string, unknown> = {
    status: { in: filters?.status ? [filters.status] : ["WAITING", "LIVE"] },
  }

  if (filters?.search) {
    where.name = { contains: filters.search, mode: "insensitive" }
  }

  if (filters?.type) {
    where.type = filters.type
  }

  const sessions = await prisma.session.findMany({
    where,
    include: {
      moderator: { select: { username: true } },
      _count: { select: { participatesIns: { where: { left_at: null } } } },
    },
    orderBy: { created_at: "desc" },
  })

  return sessions
}

export async function getSessionByCode(code: string) {
  const session = await prisma.session.findUnique({
    where: { code },
    include: {
      moderator: { select: { id: true, username: true, realname: true } },
      hosts: {
        include: { creator: { select: { id: true, username: true, realname: true } } },
      },
      participatesIns: {
        where: { left_at: null },
        include: {
          participant: { select: { id: true, username: true, realname: true } },
        },
      },
    },
  })

  return session
}

export async function joinSession(sessionId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      status: true,
      max_participants: true,
      _count: { select: { participatesIns: { where: { left_at: null } } } },
    },
  })

  if (!session) throw new Error("Session not found")
  if (session.status === "ENDED") throw new Error("Session has ended")
  if (session._count.participatesIns >= session.max_participants) {
    throw new Error("Session is full")
  }

  // Check for existing participation (re-join case)
  const existing = await prisma.participatesIn.findUnique({
    where: {
      participant_id_session_id: {
        participant_id: user.id,
        session_id: sessionId,
      },
    },
  })

  if (existing) {
    // Re-join: clear left_at
    await prisma.participatesIn.update({
      where: {
        participant_id_session_id: {
          participant_id: user.id,
          session_id: sessionId,
        },
      },
      data: { left_at: null },
    })
  } else {
    await prisma.participatesIn.create({
      data: {
        participant_id: user.id,
        session_id: sessionId,
        role: "AUDIENCE",
      },
    })
  }
}

export async function leaveSession(sessionId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  await prisma.participatesIn.update({
    where: {
      participant_id_session_id: {
        participant_id: user.id,
        session_id: sessionId,
      },
    },
    data: { left_at: new Date() },
  })
}

export async function updateSessionStatus(sessionId: string, status: SessionStatus) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  // Verify the user is the moderator or a host
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { hosts: true },
  })

  if (!session) throw new Error("Session not found")

  const isModerator = session.moderator_id === user.id
  const isHost = session.hosts.some(h => h.creator_id === user.id)

  if (!isModerator && !isHost) {
    throw new Error("Only moderators or hosts can update session status")
  }

  const data: Record<string, unknown> = { status }
  if (status === "ENDED") {
    data.ended_at = new Date()
  }

  await prisma.session.update({
    where: { id: sessionId },
    data,
  })
}
