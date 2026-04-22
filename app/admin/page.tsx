import { getAdminDashboardStats, getAdminAuditLog } from "@/lib/actions/admin"
import AdminClient from "./AdminClient"

export const dynamic = "force-dynamic"

export default async function AdminPage() {
  const [stats, auditLog] = await Promise.all([
    getAdminDashboardStats(),
    getAdminAuditLog({ page: 1, limit: 10 }),
  ])

  return <AdminClient initialStats={stats} initialAuditLog={auditLog} />
}
