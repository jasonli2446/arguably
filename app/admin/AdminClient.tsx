'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import * as Tabs from '@radix-ui/react-tabs'
import {
  Shield, Users, Activity, Settings, Ban, Clock, Search,
  Power, ChevronLeft, ChevronRight, UserCheck, ArrowUpDown,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import FloatingNav from '@/components/FloatingNav'
import {
  getAdminUsers,
  getAdminSessions,
  getPlatformConfig,
  adminBanUser,
  adminUnbanUser,
  adminSuspendUser,
  adminChangeUserRole,
  adminForceEndSession,
  updatePlatformConfig,
} from '@/lib/actions/admin'

// ── Types ──

type DashboardStats = {
  totalUsers: number
  activeUsers: number
  liveSessions: number
  totalSessions: number
  recentSignups: number
}

type AuditEntry = {
  id: string
  action: string
  target_type: string
  target_id: string
  details: unknown
  created_at: Date
  admin: { username: string }
}

type AuditLogData = {
  entries: AuditEntry[]
  total: number
  page: number
  limit: number
  totalPages: number
}

type AdminUser = {
  id: string
  username: string
  email: string | null
  role: string
  created_at: Date
  banned_at: Date | null
  ban_reason: string | null
  suspended_until: Date | null
  deleted_at: Date | null
}

type AdminSession = {
  id: string
  code: string
  name: string
  type: string
  status: string
  created_at: Date
  ended_at: Date | null
  host: { username: string }
  _count: { participates_ins: number }
}

type PlatformConfigData = {
  id: string
  default_turn_length: number
  default_audience_cap: number
  max_turn_length: number
  max_audience_cap: number
  allow_new_sessions: boolean
  maintenance_message: string | null
  updated_at: Date
}

interface AdminClientProps {
  initialStats: DashboardStats
  initialAuditLog: AuditLogData
}

// ── Helpers ──

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === 'LIVE' ? 'success' :
    status === 'PAUSED' ? 'warning' :
    status === 'ENDED' ? 'secondary' :
    'info'
  return <Badge variant={variant} className="debate-badge">{status}</Badge>
}

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge
      variant={role === 'ADMIN' ? 'destructive' : 'secondary'}
      className="debate-badge"
    >
      {role}
    </Badge>
  )
}

function UserStatusBadge({ user }: { user: AdminUser }) {
  if (user.deleted_at) return <Badge variant="secondary" className="debate-badge">DELETED</Badge>
  if (user.banned_at) return <Badge variant="destructive" className="debate-badge">BANNED</Badge>
  if (user.suspended_until && new Date(user.suspended_until) > new Date()) {
    return <Badge variant="warning" className="debate-badge">SUSPENDED</Badge>
  }
  return <Badge variant="success" className="debate-badge">ACTIVE</Badge>
}

function Pagination({
  page, totalPages, onPageChange,
}: {
  page: number; totalPages: number; onPageChange: (p: number) => void
}) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-3 mt-6">
      <Button
        variant="outline"
        size="sm"
        className="debate-button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft className="w-4 h-4" />
      </Button>
      <span className="debate-mono text-sm text-gray-400">
        {page} / {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        className="debate-button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        <ChevronRight className="w-4 h-4" />
      </Button>
    </div>
  )
}

// ── Tab content components ──

function DashboardTab({ stats, auditLog }: { stats: DashboardStats; auditLog: AuditLogData }) {
  const statCards = [
    { label: 'TOTAL USERS', value: stats.totalUsers, icon: Users },
    { label: 'ACTIVE USERS', value: stats.activeUsers, icon: UserCheck },
    { label: 'LIVE SESSIONS', value: stats.liveSessions, icon: Activity },
    { label: 'TOTAL SESSIONS', value: stats.totalSessions, icon: Power },
    { label: 'SIGNUPS (7D)', value: stats.recentSignups, icon: Clock },
  ]

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {statCards.map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <Card className="debate-card">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 bg-red-600 border-2 border-black dark:border-white/20 flex items-center justify-center">
                    <card.icon className="w-4 h-4 text-white" />
                  </div>
                </div>
                <p className="text-2xl font-black text-white">{card.value}</p>
                <p className="debate-mono text-xs text-gray-400 mt-1">{card.label}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div>
        <h3 className="text-lg font-bold text-white mb-4">RECENT ACTIVITY</h3>
        {auditLog.entries.length === 0 ? (
          <p className="debate-mono text-sm text-gray-500">No admin actions yet.</p>
        ) : (
          <div className="space-y-2">
            {auditLog.entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between p-3 border-2 border-white/20 bg-gray-900/50"
              >
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="debate-badge">{entry.action}</Badge>
                  <span className="debate-mono text-sm text-gray-300">
                    {entry.admin.username} → {entry.target_type}
                  </span>
                </div>
                <span className="debate-mono text-xs text-gray-500">
                  {new Date(entry.created_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Dialog state
  const [banDialog, setBanDialog] = useState<{ open: boolean; userId: string; username: string }>({ open: false, userId: '', username: '' })
  const [banReason, setBanReason] = useState('')
  const [unbanDialog, setUnbanDialog] = useState<{ open: boolean; userId: string; username: string }>({ open: false, userId: '', username: '' })
  const [suspendDialog, setSuspendDialog] = useState<{ open: boolean; userId: string; username: string }>({ open: false, userId: '', username: '' })
  const [suspendUntil, setSuspendUntil] = useState('')
  const [suspendReason, setSuspendReason] = useState('')
  const [roleDialog, setRoleDialog] = useState<{ open: boolean; userId: string; username: string; currentRole: string }>({ open: false, userId: '', username: '', currentRole: '' })

  const fetchUsers = useCallback(async (p: number, s: string) => {
    setLoading(true)
    try {
      const result = await getAdminUsers({ search: s || undefined, page: p, limit: 20 })
      setUsers(result.users as AdminUser[])
      setTotal(result.total)
      setPage(result.page)
      setTotalPages(result.totalPages)
    } catch {
      showToast('Failed to load users', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchUsers(1, '') }, [fetchUsers])

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const handleSearch = () => {
    setPage(1)
    fetchUsers(1, search)
  }

  const handleBan = async () => {
    if (!banReason.trim()) return
    setActionLoading(true)
    try {
      await adminBanUser(banDialog.userId, banReason.trim())
      showToast(`Banned ${banDialog.username}`, 'success')
      setBanDialog({ open: false, userId: '', username: '' })
      setBanReason('')
      fetchUsers(page, search)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to ban user', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const handleUnban = async () => {
    setActionLoading(true)
    try {
      await adminUnbanUser(unbanDialog.userId)
      showToast(`Unbanned ${unbanDialog.username}`, 'success')
      setUnbanDialog({ open: false, userId: '', username: '' })
      fetchUsers(page, search)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to unban user', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const handleSuspend = async () => {
    if (!suspendUntil || !suspendReason.trim()) return
    setActionLoading(true)
    try {
      await adminSuspendUser(suspendDialog.userId, suspendUntil, suspendReason.trim())
      showToast(`Suspended ${suspendDialog.username}`, 'success')
      setSuspendDialog({ open: false, userId: '', username: '' })
      setSuspendUntil('')
      setSuspendReason('')
      fetchUsers(page, search)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to suspend user', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const handleRoleChange = async () => {
    setActionLoading(true)
    const newRole = roleDialog.currentRole === 'ADMIN' ? 'USER' : 'ADMIN'
    try {
      await adminChangeUserRole(roleDialog.userId, newRole as 'ADMIN' | 'USER')
      showToast(`Changed ${roleDialog.username} to ${newRole}`, 'success')
      setRoleDialog({ open: false, userId: '', username: '', currentRole: '' })
      fetchUsers(page, search)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to change role', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 border-2 debate-mono text-sm ${
          toast.type === 'success' ? 'bg-green-900/90 border-green-500 text-green-300' : 'bg-red-900/90 border-red-500 text-red-300'
        }`}>
          {toast.message}
        </div>
      )}

      {/* Search */}
      <div className="flex gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search by username or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="debate-input w-full pl-10"
          />
        </div>
        <Button className="debate-button bg-red-600 text-white border-black" onClick={handleSearch}>
          SEARCH
        </Button>
      </div>

      {/* User count */}
      <p className="debate-mono text-xs text-gray-500 mb-4">{total} users found</p>

      {/* User table */}
      {loading ? (
        <p className="debate-mono text-sm text-gray-500">Loading...</p>
      ) : (
        <div className="space-y-2">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex items-center justify-between p-4 border-2 border-white/20 bg-gray-900/50"
            >
              <div className="flex items-center gap-4">
                <div>
                  <p className="font-bold text-white">{user.username}</p>
                  <p className="debate-mono text-xs text-gray-500">{user.email || 'No email'}</p>
                </div>
                <RoleBadge role={user.role} />
                <UserStatusBadge user={user} />
              </div>
              <div className="flex items-center gap-2">
                {!user.deleted_at && (
                  <>
                    {user.banned_at ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="debate-button"
                        onClick={() => setUnbanDialog({ open: true, userId: user.id, username: user.username })}
                      >
                        <UserCheck className="w-3 h-3 mr-1" /> UNBAN
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="debate-button"
                          onClick={() => setBanDialog({ open: true, userId: user.id, username: user.username })}
                        >
                          <Ban className="w-3 h-3 mr-1" /> BAN
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="debate-button"
                          onClick={() => setSuspendDialog({ open: true, userId: user.id, username: user.username })}
                        >
                          <Clock className="w-3 h-3 mr-1" /> SUSPEND
                        </Button>
                      </>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="debate-button"
                      onClick={() => setRoleDialog({ open: true, userId: user.id, username: user.username, currentRole: user.role })}
                    >
                      <ArrowUpDown className="w-3 h-3 mr-1" /> ROLE
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={(p) => fetchUsers(p, search)} />

      {/* Ban dialog */}
      <ConfirmDialog
        open={banDialog.open}
        onOpenChange={(open) => { setBanDialog(prev => ({ ...prev, open })); if (!open) setBanReason('') }}
        title={`BAN ${banDialog.username.toUpperCase()}`}
        description="This will permanently ban the user from the platform. Enter a reason:"
        confirmLabel="BAN USER"
        variant="destructive"
        loading={actionLoading}
        onConfirm={handleBan}
      />
      {/* Ban reason input rendered inside the dialog via a workaround */}
      {banDialog.open && (
        <div className="fixed left-1/2 top-1/2 z-[51] w-full max-w-md -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          <div className="mt-16 px-6 pointer-events-auto">
            <input
              type="text"
              placeholder="Reason for ban..."
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              className="debate-input w-full"
              autoFocus
            />
          </div>
        </div>
      )}

      {/* Unban dialog */}
      <ConfirmDialog
        open={unbanDialog.open}
        onOpenChange={(open) => setUnbanDialog(prev => ({ ...prev, open }))}
        title={`UNBAN ${unbanDialog.username.toUpperCase()}`}
        description="This will remove the ban and allow the user to access the platform again."
        confirmLabel="UNBAN USER"
        loading={actionLoading}
        onConfirm={handleUnban}
      />

      {/* Suspend dialog */}
      <ConfirmDialog
        open={suspendDialog.open}
        onOpenChange={(open) => { setSuspendDialog(prev => ({ ...prev, open })); if (!open) { setSuspendUntil(''); setSuspendReason('') } }}
        title={`SUSPEND ${suspendDialog.username.toUpperCase()}`}
        description="Temporarily suspend this user. Enter a date and reason:"
        confirmLabel="SUSPEND USER"
        variant="destructive"
        loading={actionLoading}
        onConfirm={handleSuspend}
      />
      {suspendDialog.open && (
        <div className="fixed left-1/2 top-1/2 z-[51] w-full max-w-md -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          <div className="mt-16 px-6 pointer-events-auto space-y-2">
            <input
              type="datetime-local"
              value={suspendUntil}
              onChange={(e) => setSuspendUntil(e.target.value)}
              className="debate-input w-full"
            />
            <input
              type="text"
              placeholder="Reason for suspension..."
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              className="debate-input w-full"
            />
          </div>
        </div>
      )}

      {/* Role change dialog */}
      <ConfirmDialog
        open={roleDialog.open}
        onOpenChange={(open) => setRoleDialog(prev => ({ ...prev, open }))}
        title={`CHANGE ROLE: ${roleDialog.username.toUpperCase()}`}
        description={`Change role from ${roleDialog.currentRole} to ${roleDialog.currentRole === 'ADMIN' ? 'USER' : 'ADMIN'}?`}
        confirmLabel="CHANGE ROLE"
        loading={actionLoading}
        onConfirm={handleRoleChange}
      />
    </div>
  )
}

function SessionsTab() {
  const [sessions, setSessions] = useState<AdminSession[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [endDialog, setEndDialog] = useState<{ open: boolean; sessionId: string; name: string }>({ open: false, sessionId: '', name: '' })

  const fetchSessions = useCallback(async (p: number, s: string, status: string) => {
    setLoading(true)
    try {
      const result = await getAdminSessions({
        search: s || undefined,
        status: (status || undefined) as 'WAITING' | 'LIVE' | 'PAUSED' | 'ENDED' | undefined,
        page: p,
        limit: 20,
      })
      setSessions(result.sessions as AdminSession[])
      setTotal(result.total)
      setPage(result.page)
      setTotalPages(result.totalPages)
    } catch {
      showToast('Failed to load sessions', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSessions(1, '', '') }, [fetchSessions])

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const handleSearch = () => {
    setPage(1)
    fetchSessions(1, search, statusFilter)
  }

  const handleForceEnd = async () => {
    setActionLoading(true)
    try {
      await adminForceEndSession(endDialog.sessionId)
      showToast(`Ended session: ${endDialog.name}`, 'success')
      setEndDialog({ open: false, sessionId: '', name: '' })
      fetchSessions(page, search, statusFilter)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to end session', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div>
      {toast && (
        <div className={`fixed top-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 border-2 debate-mono text-sm ${
          toast.type === 'success' ? 'bg-green-900/90 border-green-500 text-green-300' : 'bg-red-900/90 border-red-500 text-red-300'
        }`}>
          {toast.message}
        </div>
      )}

      <div className="flex gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search by name or code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="debate-input w-full pl-10"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); fetchSessions(1, search, e.target.value) }}
          className="debate-input"
        >
          <option value="">ALL STATUS</option>
          <option value="WAITING">WAITING</option>
          <option value="LIVE">LIVE</option>
          <option value="PAUSED">PAUSED</option>
          <option value="ENDED">ENDED</option>
        </select>
        <Button className="debate-button bg-red-600 text-white border-black" onClick={handleSearch}>
          SEARCH
        </Button>
      </div>

      <p className="debate-mono text-xs text-gray-500 mb-4">{total} sessions found</p>

      {loading ? (
        <p className="debate-mono text-sm text-gray-500">Loading...</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="flex items-center justify-between p-4 border-2 border-white/20 bg-gray-900/50"
            >
              <div className="flex items-center gap-4">
                <div>
                  <p className="font-bold text-white">{session.name}</p>
                  <p className="debate-mono text-xs text-gray-500">
                    Code: {session.code} · Host: {session.host.username} · {session._count.participates_ins} participants
                  </p>
                </div>
                <StatusBadge status={session.status} />
                <Badge variant="outline" className="debate-badge">{session.type}</Badge>
              </div>
              <div className="flex items-center gap-2">
                {session.status !== 'ENDED' && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="debate-button"
                    onClick={() => setEndDialog({ open: true, sessionId: session.id, name: session.name })}
                  >
                    <Power className="w-3 h-3 mr-1" /> END
                  </Button>
                )}
                <span className="debate-mono text-xs text-gray-500">
                  {new Date(session.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={(p) => fetchSessions(p, search, statusFilter)} />

      <ConfirmDialog
        open={endDialog.open}
        onOpenChange={(open) => setEndDialog(prev => ({ ...prev, open }))}
        title="FORCE END SESSION"
        description={`Are you sure you want to force-end "${endDialog.name}"? This cannot be undone. Note: connected participants will need to refresh.`}
        confirmLabel="END SESSION"
        variant="destructive"
        loading={actionLoading}
        onConfirm={handleForceEnd}
      />
    </div>
  )
}

function SettingsTab() {
  const [config, setConfig] = useState<PlatformConfigData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Editable fields
  const [defaultTurnLength, setDefaultTurnLength] = useState(120)
  const [defaultAudienceCap, setDefaultAudienceCap] = useState(10)
  const [maxTurnLength, setMaxTurnLength] = useState(1800)
  const [maxAudienceCap, setMaxAudienceCap] = useState(1000)
  const [allowNewSessions, setAllowNewSessions] = useState(true)
  const [maintenanceMessage, setMaintenanceMessage] = useState('')

  useEffect(() => {
    getPlatformConfig().then((c) => {
      setConfig(c)
      setDefaultTurnLength(c.default_turn_length)
      setDefaultAudienceCap(c.default_audience_cap)
      setMaxTurnLength(c.max_turn_length)
      setMaxAudienceCap(c.max_audience_cap)
      setAllowNewSessions(c.allow_new_sessions)
      setMaintenanceMessage(c.maintenance_message || '')
      setLoading(false)
    }).catch(() => {
      showToast('Failed to load config', 'error')
      setLoading(false)
    })
  }, [])

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await updatePlatformConfig({
        default_turn_length: defaultTurnLength,
        default_audience_cap: defaultAudienceCap,
        max_turn_length: maxTurnLength,
        max_audience_cap: maxAudienceCap,
        allow_new_sessions: allowNewSessions,
        maintenance_message: maintenanceMessage.trim() || null,
      })
      setConfig(updated)
      showToast('Configuration saved', 'success')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to save config', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="debate-mono text-sm text-gray-500">Loading...</p>

  return (
    <div>
      {toast && (
        <div className={`fixed top-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 border-2 debate-mono text-sm ${
          toast.type === 'success' ? 'bg-green-900/90 border-green-500 text-green-300' : 'bg-red-900/90 border-red-500 text-red-300'
        }`}>
          {toast.message}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="debate-card">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-600 border-2 border-black dark:border-white/20 flex items-center justify-center">
                <Clock className="w-5 h-5 text-white" />
              </div>
              <CardTitle className="text-lg font-black text-white">Turn Duration</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="debate-mono text-xs text-gray-300 font-semibold block mb-1">
                DEFAULT TURN LENGTH (seconds)
              </label>
              <input
                type="number"
                min={30}
                max={1800}
                value={defaultTurnLength}
                onChange={(e) => setDefaultTurnLength(Number(e.target.value))}
                className="debate-input w-full"
              />
            </div>
            <div>
              <label className="debate-mono text-xs text-gray-300 font-semibold block mb-1">
                MAX TURN LENGTH (seconds)
              </label>
              <input
                type="number"
                min={30}
                max={1800}
                value={maxTurnLength}
                onChange={(e) => setMaxTurnLength(Number(e.target.value))}
                className="debate-input w-full"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="debate-card">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-600 border-2 border-black dark:border-white/20 flex items-center justify-center">
                <Users className="w-5 h-5 text-white" />
              </div>
              <CardTitle className="text-lg font-black text-white">Audience</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="debate-mono text-xs text-gray-300 font-semibold block mb-1">
                DEFAULT AUDIENCE CAP
              </label>
              <input
                type="number"
                min={1}
                max={1000}
                value={defaultAudienceCap}
                onChange={(e) => setDefaultAudienceCap(Number(e.target.value))}
                className="debate-input w-full"
              />
            </div>
            <div>
              <label className="debate-mono text-xs text-gray-300 font-semibold block mb-1">
                MAX AUDIENCE CAP
              </label>
              <input
                type="number"
                min={1}
                max={1000}
                value={maxAudienceCap}
                onChange={(e) => setMaxAudienceCap(Number(e.target.value))}
                className="debate-input w-full"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="debate-card">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-600 border-2 border-black dark:border-white/20 flex items-center justify-center">
                <Settings className="w-5 h-5 text-white" />
              </div>
              <CardTitle className="text-lg font-black text-white">Platform</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="debate-mono text-xs text-gray-300 font-semibold">
                ALLOW NEW SESSIONS
              </label>
              <button
                onClick={() => setAllowNewSessions(!allowNewSessions)}
                className={`w-14 h-8 border-2 border-black dark:border-white/20 transition-colors relative ${
                  allowNewSessions ? 'bg-red-600' : 'bg-gray-600'
                }`}
              >
                <div className={`w-6 h-6 bg-white border-2 border-black absolute top-0.5 transition-all ${
                  allowNewSessions ? 'left-6' : 'left-0.5'
                }`} />
              </button>
            </div>
            <div>
              <label className="debate-mono text-xs text-gray-300 font-semibold block mb-1">
                MAINTENANCE MESSAGE
              </label>
              <input
                type="text"
                placeholder="Leave empty for no message..."
                value={maintenanceMessage}
                onChange={(e) => setMaintenanceMessage(e.target.value)}
                className="debate-input w-full"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-center mt-8">
        <Button
          className="debate-button bg-red-600 text-white border-black"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'SAVING...' : 'SAVE CONFIGURATION'}
        </Button>
      </div>

      {config && (
        <p className="debate-mono text-xs text-gray-500 text-center mt-4">
          Last updated: {new Date(config.updated_at).toLocaleString()}
        </p>
      )}
    </div>
  )
}

// ── Main component ──

export default function AdminClient({ initialStats, initialAuditLog }: AdminClientProps) {
  return (
    <div className="min-h-screen debate-container bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 dark">
      <div className="debate-texture fixed inset-0" />
      <FloatingNav />

      <main className="relative z-10 pt-32 pb-20">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="flex items-center gap-4 mb-2">
              <div className="w-12 h-12 bg-red-600 border-2 border-black flex items-center justify-center">
                <Shield className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-6xl md:text-7xl font-black text-white">
                ADMIN <span className="text-red-400">PANEL</span>
              </h1>
            </div>
            <p className="text-xl text-gray-400 mb-12 ml-16">
              Platform management and moderation
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
          >
            <Tabs.Root defaultValue="dashboard">
              <Tabs.List className="flex gap-2 mb-8 flex-wrap">
                {[
                  { value: 'dashboard', label: 'DASHBOARD', icon: Activity },
                  { value: 'users', label: 'USERS', icon: Users },
                  { value: 'sessions', label: 'SESSIONS', icon: Power },
                  { value: 'settings', label: 'SETTINGS', icon: Settings },
                ].map((tab) => (
                  <Tabs.Trigger
                    key={tab.value}
                    value={tab.value}
                    className="flex items-center gap-2 px-4 py-2.5 border-2 border-white/20 debate-mono text-sm font-bold text-gray-400 transition-all data-[state=active]:bg-red-600 data-[state=active]:text-white data-[state=active]:border-red-600 hover:border-white/40"
                    style={{ transform: 'skew(-2deg)' }}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>

              <Tabs.Content value="dashboard">
                <DashboardTab stats={initialStats} auditLog={initialAuditLog} />
              </Tabs.Content>
              <Tabs.Content value="users">
                <UsersTab />
              </Tabs.Content>
              <Tabs.Content value="sessions">
                <SessionsTab />
              </Tabs.Content>
              <Tabs.Content value="settings">
                <SettingsTab />
              </Tabs.Content>
            </Tabs.Root>
          </motion.div>
        </div>
      </main>
    </div>
  )
}
