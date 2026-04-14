"use server"

import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/actions/utils"

const VALID_THEMES = ["dark", "light", "system"] as const
const VALID_FONT_SIZES = ["small", "medium", "large"] as const
const VALID_PROFILE_VISIBILITY = ["public", "private"] as const

type UserPreferences = {
    bio?: string | null
    notify_invitations?: boolean
    notify_messages?: boolean
    notify_weekly_digest?: boolean
    profile_visibility?: string
    show_online_status?: boolean
    allow_direct_messages?: boolean
    theme?: string
    font_size?: string
    animations_enabled?: boolean
    language?: string
    timezone?: string
    date_format?: string
}

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

    return result
}

export async function getUserPreferences() {
    const user = await requireAuth()

    return await prisma.user.findUnique({
        where: { id: user.id },
        select: {
            username: true,
            email: true,
            realname: true,
            bio: true,
            notify_invitations: true,
            notify_messages: true,
            notify_weekly_digest: true,
            profile_visibility: true,
            show_online_status: true,
            allow_direct_messages: true,
            theme: true,
            font_size: true,
            animations_enabled: true,
            language: true,
            timezone: true,
            date_format: true,
        },
    })
}

export async function updateUserPreferences(prefs: UserPreferences) {
    const user = await requireAuth()

    // Validate allowed values
    if (prefs.theme !== undefined && !VALID_THEMES.includes(prefs.theme as typeof VALID_THEMES[number])) {
        throw new Error("Theme must be 'dark', 'light', or 'system'")
    }
    if (prefs.font_size !== undefined && !VALID_FONT_SIZES.includes(prefs.font_size as typeof VALID_FONT_SIZES[number])) {
        throw new Error("Font size must be 'small', 'medium', or 'large'")
    }
    if (prefs.profile_visibility !== undefined && !VALID_PROFILE_VISIBILITY.includes(prefs.profile_visibility as typeof VALID_PROFILE_VISIBILITY[number])) {
        throw new Error("Profile visibility must be 'public' or 'private'")
    }

    return await prisma.user.update({
        where: { id: user.id },
        data: prefs,
    })
}
