"use server"

import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/lib/generated/prisma"
import { preferencesSchema, type UserPreferences } from "@/lib/constants/preferences"

export async function ensureUserProfile() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return null

    const email = user.email ?? ""
    const username = email.split("@")[0] || `user-${user.id.slice(0, 8)}`

    // Handle potential username collision
    let finalUsername = username
    let suffix = 1
    while (await prisma.user.findUnique({ where: { username: finalUsername } })) {
        // Check it's not our own existing record
        const owner = await prisma.user.findFirst({ where: { username: finalUsername, id: user.id } })
        if (owner) break
        finalUsername = `${username}-${suffix}`
        suffix++
    }

    // Use upsert to avoid race condition between concurrent requests
    const result = await prisma.user.upsert({
        where: { id: user.id },
        update: {},
        create: {
            id: user.id,
            username: finalUsername,
            email: email || null,
        },
    })

    if (result.deleted_at) return null
    return result
}

export async function getUserProfile() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const profile = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
            id: true,
            username: true,
            email: true,
            realname: true,
            bio: true,
            preferences: true,
            created_at: true,
        },
    })

    return profile
}

export async function updateUserProfile(data: {
    username?: string
    realname?: string
    bio?: string
    preferences?: UserPreferences
}) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error("Not authenticated")

    // Validate username
    if (data.username !== undefined) {
        const trimmed = data.username.trim()
        if (!trimmed) throw new Error("Username cannot be empty")
        if (trimmed.length < 3) throw new Error("Username must be at least 3 characters")
        if (trimmed.length > 30) throw new Error("Username must be 30 characters or fewer")
        if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
            throw new Error("Username can only contain letters, numbers, hyphens, and underscores")
        }
    }

    // Validate bio
    if (data.bio !== undefined && data.bio.length > 500) {
        throw new Error("Bio must be 500 characters or fewer")
    }

    // Validate preferences
    if (data.preferences !== undefined) {
        const result = preferencesSchema.safeParse(data.preferences)
        if (!result.success) {
            throw new Error("Invalid preferences")
        }
    }

    try {
        const updated = await prisma.user.update({
            where: { id: user.id },
            data: {
                ...(data.username !== undefined && { username: data.username.trim() }),
                ...(data.realname !== undefined && { realname: data.realname.trim() || null }),
                ...(data.bio !== undefined && { bio: data.bio.trim() || null }),
                ...(data.preferences !== undefined && { preferences: data.preferences as unknown as Prisma.JsonObject }),
            },
        })
        return { success: true, user: updated }
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw new Error("Username already taken")
        }
        throw error
    }
}

export async function deleteAccount() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error("Not authenticated")

    await prisma.$transaction(async (tx) => {
        // Soft-delete the user
        await tx.user.update({
            where: { id: user.id },
            data: { deleted_at: new Date() },
        })

        // Remove user from all session participations
        await tx.participatesIn.deleteMany({
            where: { user_id: user.id },
        })

        // Unset moderator on sessions where user is moderator
        await tx.session.updateMany({
            where: { moderator_id: user.id },
            data: { moderator_id: null },
        })

        // End and clean up hosted sessions
        const hostedSessions = await tx.session.findMany({
            where: { host_id: user.id },
            select: { id: true },
        })
        const sessionIds = hostedSessions.map(s => s.id)

        if (sessionIds.length > 0) {
            await tx.debateState.deleteMany({ where: { session_id: { in: sessionIds } } })
            await tx.participatesIn.deleteMany({ where: { session_id: { in: sessionIds } } })
            await tx.session.deleteMany({ where: { id: { in: sessionIds } } })
        }
    })

    await supabase.auth.signOut()
}
