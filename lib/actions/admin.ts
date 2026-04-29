"use server"

import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/actions/utils"
import { type SessionStatus, type UniversalRole } from "@/lib/generated/prisma"

// ── Validation schemas ──

const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
})

const userSearchSchema = paginationSchema.extend({
  search: z.string().optional(),
})

const sessionSearchSchema = paginationSchema.extend({
  search: z.string().optional(),
  status: z.enum(["WAITING", "LIVE", "PAUSED", "ENDED"]).optional(),
})

const configUpdateSchema = z.object({
  default_turn_length: z.number().int().min(30).max(1800).optional(),
  default_audience_cap: z.number().int().min(1).max(1000).optional(),
  max_turn_length: z.number().int().min(30).max(1800).optional(),
  max_audience_cap: z.number().int().min(1).max(1000).optional(),
  allow_new_sessions: z.boolean().optional(),
  maintenance_message: z.string().max(500).nullable().optional(),
})

// ── Dashboard ──

/** Returns aggregate counts for the admin dashboard. */
export async function getAdminDashboardStats() {
  await requireAdmin()

  const [totalUsers, activeUsers, liveSessions, totalSessions, recentSignups] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({
        where: { banned_at: null, deleted_at: null },
      }),
      prisma.session.count({
        where: { status: { in: ["LIVE", "PAUSED"] } },
      }),
      prisma.session.count(),
      prisma.user.count({
        where: {
          created_at: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
    ])

  return { totalUsers, activeUsers, liveSessions, totalSessions, recentSignups }
}

// ── User management ──

/** Lists users for admin review with optional search and pagination. */
export async function getAdminUsers(params: {
  search?: string
  page?: number
  limit?: number
}) {
  await requireAdmin()

  const { search, page, limit } = userSearchSchema.parse(params)
  const skip = (page - 1) * limit

  const where = search
    ? {
        OR: [
          { username: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {}

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        created_at: true,
        banned_at: true,
        ban_reason: true,
        suspended_until: true,
        deleted_at: true,
      },
      orderBy: { created_at: "desc" },
      skip,
      take: limit,
    }),
    prisma.user.count({ where }),
  ])

  return { users, total, page, limit, totalPages: Math.ceil(total / limit) }
}

/** Bans a user account and records the admin audit entry. */
export async function adminBanUser(userId: string, reason: string) {
  const admin = await requireAdmin()

  if (userId === admin.id) throw new Error("Cannot ban yourself")

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, banned_at: true, username: true },
  })
  if (!target) throw new Error("User not found")
  if (target.banned_at) throw new Error("User is already banned")

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { banned_at: new Date(), ban_reason: reason, banned_by: admin.id },
    }),
    prisma.adminAuditLog.create({
      data: {
        admin_id: admin.id,
        action: "BAN_USER",
        target_type: "User",
        target_id: userId,
        details: { reason, username: target.username },
      },
    }),
  ])
}

/** Removes a user's ban and suspension state and records the admin audit entry. */
export async function adminUnbanUser(userId: string) {
  const admin = await requireAdmin()

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, banned_at: true, username: true },
  })
  if (!target) throw new Error("User not found")
  if (!target.banned_at) throw new Error("User is not banned")

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        banned_at: null,
        ban_reason: null,
        banned_by: null,
        suspended_until: null,
      },
    }),
    prisma.adminAuditLog.create({
      data: {
        admin_id: admin.id,
        action: "UNBAN_USER",
        target_type: "User",
        target_id: userId,
        details: { username: target.username },
      },
    }),
  ])
}

/** Suspends a user until a future timestamp and records the admin audit entry. */
export async function adminSuspendUser(
  userId: string,
  until: string,
  reason: string
) {
  const admin = await requireAdmin()

  if (userId === admin.id) throw new Error("Cannot suspend yourself")

  const untilDate = new Date(until)
  if (isNaN(untilDate.getTime()) || untilDate <= new Date()) {
    throw new Error("Suspension date must be in the future")
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, banned_at: true, username: true },
  })
  if (!target) throw new Error("User not found")
  if (target.banned_at) throw new Error("User is already banned — unban first")

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { suspended_until: untilDate, ban_reason: reason },
    }),
    prisma.adminAuditLog.create({
      data: {
        admin_id: admin.id,
        action: "SUSPEND_USER",
        target_type: "User",
        target_id: userId,
        details: { reason, until: untilDate.toISOString(), username: target.username },
      },
    }),
  ])
}

/** Changes a user's platform role and records the admin audit entry. */
export async function adminChangeUserRole(
  userId: string,
  newRole: UniversalRole
) {
  const admin = await requireAdmin()

  if (userId === admin.id) throw new Error("Cannot change your own role")

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, username: true },
  })
  if (!target) throw new Error("User not found")
  if (target.role === newRole) throw new Error("User already has this role")

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { role: newRole },
    }),
    prisma.adminAuditLog.create({
      data: {
        admin_id: admin.id,
        action: "CHANGE_ROLE",
        target_type: "User",
        target_id: userId,
        details: {
          username: target.username,
          oldRole: target.role,
          newRole,
        },
      },
    }),
  ])
}

// ── Session management ──

/** Lists sessions for admin review with optional search, status filter, and pagination. */
export async function getAdminSessions(params: {
  search?: string
  status?: SessionStatus
  page?: number
  limit?: number
}) {
  await requireAdmin()

  const { search, status, page, limit } = sessionSearchSchema.parse(params)
  const skip = (page - 1) * limit

  const where = {
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { code: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  }

  const [sessions, total] = await Promise.all([
    prisma.session.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        status: true,
        created_at: true,
        ended_at: true,
        host: { select: { username: true } },
        _count: { select: { participates_ins: true } },
      },
      orderBy: { created_at: "desc" },
      skip,
      take: limit,
    }),
    prisma.session.count({ where }),
  ])

  return { sessions, total, page, limit, totalPages: Math.ceil(total / limit) }
}

/** Force-ends an active session and marks any debate state as ended. */
export async function adminForceEndSession(sessionId: string) {
  const admin = await requireAdmin()

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, name: true, code: true },
  })
  if (!session) throw new Error("Session not found")
  if (session.status === "ENDED") throw new Error("Session is already ended")

  await prisma.$transaction([
    prisma.session.update({
      where: { id: sessionId },
      data: { status: "ENDED", ended_at: new Date() },
    }),
    // Also end the debate state if it exists
    prisma.debateState.updateMany({
      where: { session_id: sessionId },
      data: { phase: "ENDED" },
    }),
    prisma.adminAuditLog.create({
      data: {
        admin_id: admin.id,
        action: "END_SESSION",
        target_type: "Session",
        target_id: sessionId,
        details: { name: session.name, code: session.code },
      },
    }),
  ])
}

// ── Platform config ──

/** Returns the singleton platform configuration, creating it when missing. */
export async function getPlatformConfig() {
  await requireAdmin()

  return prisma.platformConfig.upsert({
    where: { id: "singleton" },
    create: {},
    update: {},
  })
}

/** Updates the singleton platform configuration after schema validation. */
export async function updatePlatformConfig(
  data: z.infer<typeof configUpdateSchema>
) {
  const admin = await requireAdmin()

  const validated = configUpdateSchema.parse(data)

  const config = await prisma.platformConfig.upsert({
    where: { id: "singleton" },
    create: { ...validated },
    update: { ...validated },
  })

  await prisma.adminAuditLog.create({
    data: {
      admin_id: admin.id,
      action: "UPDATE_CONFIG",
      target_type: "PlatformConfig",
      target_id: "singleton",
      details: validated,
    },
  })

  return config
}

// ── Audit log ──

/** Returns paginated admin audit log entries. */
export async function getAdminAuditLog(params: {
  page?: number
  limit?: number
}) {
  await requireAdmin()

  const { page, limit } = paginationSchema.parse(params)
  const skip = (page - 1) * limit

  const [entries, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      select: {
        id: true,
        action: true,
        target_type: true,
        target_id: true,
        details: true,
        created_at: true,
        admin: { select: { username: true } },
      },
      orderBy: { created_at: "desc" },
      skip,
      take: limit,
    }),
    prisma.adminAuditLog.count(),
  ])

  return { entries, total, page, limit, totalPages: Math.ceil(total / limit) }
}
