export const dynamic = 'force-dynamic'

import { getSessionByCode } from '@/lib/actions/session'
import { getTranscriptSegments } from '@/lib/actions/transcript'
import { getDetectedClaims } from '@/lib/actions/claims'
import { SessionRole, SessionStatus } from '@/lib/generated/prisma'
import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import RoomClient from './RoomClient'

export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const session = await getSessionByCode(code)

  if (!session) {
    notFound()
  }

  // Redirect ended sessions to replay page (before mounting RoomClient to avoid wasted WebRTC connections)
  if (session.status === SessionStatus.ENDED) {
    redirect(`/room/${code}/replay`)
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

  const transcriptSegments = await getTranscriptSegments(session.id).catch(() => [])
  const detectedClaims = await getDetectedClaims(session.id).catch(() => [])

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
    // Filter team assignments to only active participants (left_at: null already filtered in participates_ins)
    teamAssignments: (() => {
      const activeUserIds = new Set(session.participates_ins.map(p => p.user_id))
      return session.team_assignments
        .filter(ta => activeUserIds.has(ta.user_id))
        .map(ta => ({ userId: ta.user_id, team: ta.team }))
    })(),
    transcriptSegments,
    detectedClaims,
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