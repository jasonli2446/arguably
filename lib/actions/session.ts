"use server"

import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"
import { generateRoomCode } from "@/lib/utils"
import { redirect } from "next/navigation"
import { Prisma, SessionRole, SessionStatus, SessionType } from "@/lib/generated/prisma"
import { join } from "path"

export async function createSession(formData: {
    name: string
    description?: string
    type: SessionType
    maxParticipants: number
    turnLength: number
}) 
{
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
            host_id: user.id,
            // moderator to be added after session creation
            type: formData.type,
            max_participants: formData.maxParticipants,
            turn_length: formData.turnLength,
            participates_ins: {
                create: {
                    participant_id: user.id,
                    joined_at: new Date(),
                    session_role: SessionRole.HOST,
                },
            },
        },
    })

    redirect(`/room/${session.code}`)
}

async function getSessionModerator(sessionId: string) {
    const session = await prisma.session.findUnique({
        where: { id : sessionId },
        include: { moderator: true }
    })
    return session?.moderator
}

async function getSessionHost(sessionId: string) {
    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: { host: true },
    })
    return session?.host
}

export async function getSessionsByFilters(filters?: {
    search?: string
    types?: SessionType[]
    statuses?: SessionStatus[]
}) 
{
    const sessionsWhere : Prisma.SessionWhereInput = {};
    
    sessionsWhere.status = (filters?.statuses?.length)
        ? { in: filters.statuses }
        : { in: [SessionStatus.WAITING, SessionStatus.LIVE, SessionStatus.PAUSED] }
    

    if (filters?.search) 
        sessionsWhere.name = { contains: filters.search, mode: "insensitive" }
    
    sessionsWhere.type = (filters?.types?.length)
        ? { in: filters.types }
        : { in: Object.values(SessionType) }
    

    const sessions = await prisma.session.findMany({
        where: sessionsWhere,
        include: {
            // host username
            host: { select: { username: true } },
            // moderator username
            moderator: { select: { username: true } },
            // participant count
            _count: { select: { participates_ins: { where: { left_at: null } } } },
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
            host: { select: { id: true, username: true, realname: true } },
            participates_ins: {
                where: { left_at: null },
                include: {
                    user: { select: { id: true, username: true, realname: true } },
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
            _count: { select: { participates_ins: { where: { left_at: null } } } },
        },
    })

    if (!session) throw new Error("Session not found")
    if (session.status === SessionStatus.ENDED) throw new Error("Session has ended")
    if (session._count.participates_ins >= session.max_participants) {
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
                session_role: SessionRole.AUDIENCE,
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
        include: { host: true, moderator: true },
    })

    if (!session) throw new Error("Session not found")

    const isModerator = session.moderator_id === user.id
    const isHost = session.host_id === user.id

    if (!isModerator && !isHost) {
        throw new Error("Only moderators or hosts can update session status")
    }

    const data : Prisma.SessionUpdateInput = { }
    data.status = status

    if (status === SessionStatus.ENDED) {
        data.ended_at = new Date()
    }

    await prisma.session.update({
        where: { id: sessionId },
        data
    })
    
}
