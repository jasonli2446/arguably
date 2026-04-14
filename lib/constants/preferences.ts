import { z } from "zod"

export const DEFAULT_PREFERENCES = {
    notifications: {
        debateInvitations: true,
        newMessages: true,
        weeklyDigest: false,
    },
    privacy: {
        profileVisibility: "public" as const,
        showOnlineStatus: true,
        allowDirectMessages: true,
    },
    appearance: {
        theme: "dark" as const,
        fontSize: "medium" as const,
        animations: true,
    },
    language: {
        language: "en",
        timezone: "America/New_York",
        dateFormat: "MM/DD/YYYY" as const,
    },
}

export type UserPreferences = typeof DEFAULT_PREFERENCES

export const preferencesSchema = z.object({
    notifications: z.object({
        debateInvitations: z.boolean(),
        newMessages: z.boolean(),
        weeklyDigest: z.boolean(),
    }),
    privacy: z.object({
        profileVisibility: z.enum(["public", "friends", "private"]),
        showOnlineStatus: z.boolean(),
        allowDirectMessages: z.boolean(),
    }),
    appearance: z.object({
        theme: z.enum(["dark", "light", "system"]),
        fontSize: z.enum(["small", "medium", "large"]),
        animations: z.boolean(),
    }),
    language: z.object({
        language: z.string(),
        timezone: z.string(),
        dateFormat: z.enum(["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"]),
    }),
})
