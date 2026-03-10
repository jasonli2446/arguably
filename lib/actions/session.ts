"use server"

import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"
import { generateRoomCode, SessionCapacityInfo, getSessionCapacity, getTotalDebaterCapacity } from "@/lib/utils"
import { redirect } from "next/navigation"
import { Prisma, SessionRole, SessionStatus, SessionType } from "@/lib/generated/prisma"

export async function createSession(formData: {
    name: string
    description?: string
    type: SessionType
    debaterCapacityProponent: number | null
    debaterCapacityOpponent: number | null
    debaterCapacityPanel: number | null
    audienceCapacity: number
    turnLength: number
}) 
{
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error("Not authenticated")

    if (!formData.name.trim()) throw new Error("Room name is required")

    // Validate capacities
    if (formData.audienceCapacity < 0) throw new Error("Audience capacity cannot be negative")
    if (formData.turnLength < 1) throw new Error("Turn length must be at least 1 second")

    // Panel-specific validation
    if (formData.type === SessionType.PANEL) {
      if (!formData.debaterCapacityPanel || formData.debaterCapacityPanel < 2) {
        throw new Error("Panel must have at least 2 panelists")
      }
      if (formData.debaterCapacityProponent !== null || formData.debaterCapacityOpponent !== null) {
        throw new Error("Proponent and opponent capacities must be null for PANEL format")
      }
    } else {
      if (!formData.debaterCapacityProponent || formData.debaterCapacityProponent < 1) {
        throw new Error("Proponent capacity must be at least 1")
      }
      if (formData.debaterCapacityOpponent === null || formData.debaterCapacityOpponent < 0) {
        throw new Error("Opponent capacity cannot be negative")
      }
      if (formData.debaterCapacityPanel !== null) {
        throw new Error("Panel capacity must be null for non-PANEL format")
      }
    }

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
            type: formData.type,
            debater_capacity_proponent: formData.debaterCapacityProponent,
            debater_capacity_opponent: formData.debaterCapacityOpponent,
            debater_capacity_panel: formData.debaterCapacityPanel,
            audience_capacity: formData.audienceCapacity,
            turn_length: formData.turnLength,
            participates_ins: {
                create: {
                    user_id: user.id,
                    joined_at: new Date(),
                    session_role: SessionRole.HOST,
                },
            },
        },
    })

    redirect(`/room/${session.code}`)
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
            host: { select: { id: true, username: true, realname: true } },
            // moderator username
            moderator: { select: { id: true, username: true, realname: true } },
            // participant count
            _count: { select: { participates_ins: { where: { left_at: null } } } },
        },
        orderBy: { created_at: "desc" },
    })

    return sessions ?? []
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
            type: true,
            status: true,
            debater_capacity_proponent: true,
            debater_capacity_opponent: true,
            debater_capacity_panel: true,
            audience_capacity: true,
            _count: { select: { participates_ins: { where: { left_at: null } } } },
        },
    })

    if (!session) throw new Error("Session not found")
    if (session.status === SessionStatus.ENDED) throw new Error("Session has ended")
    
    const totalCapacity = getSessionCapacity({
        sessionType: session.type,
        debaterCapacityProponent: session.debater_capacity_proponent,
        debaterCapacityOpponent: session.debater_capacity_opponent,
        debaterCapacityPanel: session.debater_capacity_panel,
        audienceCapacity: session.audience_capacity,
    })
    
    if (session._count.participates_ins >= totalCapacity) {
        throw new Error("Session is full")
    }

    // Check for existing participation (re-join case)
    const existing = await prisma.participatesIn.findUnique({
        where: {
            user_id_session_id: {
                user_id: user.id,
                session_id: sessionId,
            },
        },
    })

    if (existing) {
        // Re-join: clear left_at
        await prisma.participatesIn.update({
            where: {
                user_id_session_id: {
                    user_id: user.id,
                    session_id: sessionId,
                },
            },
            data: { left_at: null },
        })
    } else {
        await prisma.participatesIn.create({
            data: {
                user_id: user.id,
                session_id: sessionId,
                session_role: SessionRole.AUDIENCE,
            },
        })
    }
}

export async function joinSessionAsDebater(sessionId: string, isProponent: boolean) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error("Not authenticated")

    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        select: {
            status: true,
            type: true,
            debater_capacity_proponent: true,
            debater_capacity_opponent: true,
            debater_capacity_panel: true,
            audience_capacity: true,
            _count: { select: { participates_ins: { where: { left_at: null } } } },
            participates_ins: {
                where: { left_at: null, session_role: { in: [SessionRole.DEBATER, SessionRole.HOST] } },
                select: { user_id: true },
            },
        },
    })

    if (!session) throw new Error("Session not found")
    if (session.status === SessionStatus.ENDED) throw new Error("Session has ended")

    const capacityInfo: SessionCapacityInfo = {
        sessionType: session.type,
        debaterCapacityProponent: session.debater_capacity_proponent,
        debaterCapacityOpponent: session.debater_capacity_opponent,
        debaterCapacityPanel: session.debater_capacity_panel,
        audienceCapacity: session.audience_capacity,
    }

    const totalDebaterCapacity = getTotalDebaterCapacity(capacityInfo)
    const totalCapacity = getSessionCapacity(capacityInfo)

    // Regardless of session type, debater capacity is consistently calculated
    if (isProponent) {
        if (session.type === SessionType.EXPERT_VS_CROWD || session.type === SessionType.ONE_ON_ONE) {
            throw new Error("Cannot join as proponent in this session type")
        }

    } else {
        if (session.participates_ins.length >= totalDebaterCapacity) {
            throw new Error(`Debate already has ${totalDebaterCapacity} debaters`)
        }
    }

    // Check total session capacity
    if (session._count.participates_ins >= totalCapacity) {
        throw new Error("Session is full")
    }

    // Check for existing participation (re-join case)
    const existing = await prisma.participatesIn.findUnique({
        where: {
            user_id_session_id: {
                user_id: user.id,
                session_id: sessionId,
            },
        },
    })

    if (existing) {
        await prisma.participatesIn.update({
            where: {
                user_id_session_id: {
                    user_id: user.id,
                    session_id: sessionId,
                },
            },
            data: { left_at: null, session_role: SessionRole.DEBATER },
        })
    } else {
        await prisma.participatesIn.create({
            data: {
                user_id: user.id,
                session_id: sessionId,
                session_role: SessionRole.DEBATER,
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
            user_id_session_id: {
                user_id: user.id,
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