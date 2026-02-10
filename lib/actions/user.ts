"use server"

import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"

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
