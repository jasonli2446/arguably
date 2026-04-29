import { z } from "zod"

/** Default user preference values applied to new or partially configured profiles. */
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

/** Static TypeScript preference shape inferred from the default preference object. */
export type UserPreferences = typeof DEFAULT_PREFERENCES

/** Runtime schema for validating persisted user preference payloads. */
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
