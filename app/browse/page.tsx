import { getSessionsByFilters } from '@/lib/actions/session'
import { getSessionCapacity } from '@/lib/utils'
import BrowseClient from './BrowseClient'

export const dynamic = 'force-dynamic'

export default async function BrowsePage() {
  const sessions = await getSessionsByFilters()

  // Serialize dates for client component
  const serialized = sessions.map((session) => ({
    id: session.id,
    code: session.code,
    name: session.name,
    type: session.type,
    status: session.status,
    turnLength: session.turn_length,
    createdAt: session.created_at.toISOString(),
    sessionCapacity: getSessionCapacity(
      {
        sessionType: session.type,
        debaterCapacityProponent: session.debater_capacity_proponent,
        debaterCapacityOpponent: session.debater_capacity_opponent,
        debaterCapacityPanel: session.debater_capacity_panel,
        audienceCapacity: session.audience_capacity
      }
    ),
    host: {
      id: session.host.id,
      username: session.host.username,
      realname: session.host.realname || 'Unknown',
    },
    moderator: session.moderator
    ? {
      id: session.moderator.id,
      username: session.moderator.username,
      realname: session.moderator.realname || 'Unknown',
    }
    : null,
    _count: { participatesIns: session._count.participates_ins },
  }))

  return <BrowseClient sessions={serialized} />
}