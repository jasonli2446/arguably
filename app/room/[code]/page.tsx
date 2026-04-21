export const dynamic = 'force-dynamic'

import { getSessionByCode } from '@/lib/actions/session'
import { SessionRole } from '@/lib/generated/prisma'
import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import RoomClient from './RoomClient'

export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const session = await getSessionByCode(code)

  if (!session) {
    notFound()
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.id) {
    notFound() // Ensure user is authenticated
  }

  const currentUserId = user.id
  const currentUser = session.participates_ins.find(
    (u) => u.user_id === currentUserId
  )
  const currentRole: SessionRole = currentUser?.session_role ?? SessionRole.AUDIENCE
  const currentUsername = currentUser?.user?.username ?? 'Anonymous'

  if (!session.host) {
    notFound()
  }

  // Serialize for client component
  const serialized = {
    id: session.id,
    code: session.code,
    name: session.name,
    type: session.type,
    status: session.status,
    turnLength: session.turn_length,
    debaterCapacityProponent: session.debater_capacity_proponent,
    debaterCapacityOpponent: session.debater_capacity_opponent,
    debaterCapacityPanel: session.debater_capacity_panel,
    audienceCapacity: session.audience_capacity,
    kickThreshold: session.kick_threshold,
    host: {
      id: session.host.id,
      username: session.host.username,
      realname: session.host.realname ?? null,
    },
    moderator: session.moderator
    ? {
      id: session.moderator.id,
      username: session.moderator.username,
      realname: session.moderator.realname ?? null,
    }
    : null,
    participatesIns: session.participates_ins.map((p) => ({
      userId: p.user_id,
      sessionRole: p.session_role,
      user: {
        id: p.user.id,
        username: p.user.username,
        realname: p.user.realname ?? null,
      },
    })),
  }

  return (
    <RoomClient
      session={serialized}
      currentUserId={currentUserId}
      currentRole={currentRole}
      currentUsername={currentUsername}
    />
  )
}