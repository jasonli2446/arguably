import { getAdminDashboardStats, getAdminAuditLog } from "@/lib/actions/admin"
import AdminClient from "./AdminClient"

/** Forces admin dashboard data to refresh on every request. */
export const dynamic = "force-dynamic"

/** Server admin dashboard page that preloads stats and the first audit page. */
export default async function AdminPage() {
  const [stats, auditLog] = await Promise.all([
    getAdminDashboardStats(),
    getAdminAuditLog({ page: 1, limit: 10 }),
  ])

  return <AdminClient initialStats={stats} initialAuditLog={auditLog} />
}
