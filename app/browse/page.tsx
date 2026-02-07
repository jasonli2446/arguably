import { listSessions } from '@/lib/actions/session'
import BrowseClient from './BrowseClient'

export const dynamic = 'force-dynamic'

export default async function BrowsePage() {
  const sessions = await listSessions()

  // Serialize dates for client component
  const serialized = sessions.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    type: s.type,
    status: s.status,
    created_at: s.created_at.toISOString(),
    max_participants: s.max_participants,
    turn_length: s.turn_length,
    moderator: s.moderator,
    _count: s._count,
  }))

  return <BrowseClient sessions={serialized} />
}
