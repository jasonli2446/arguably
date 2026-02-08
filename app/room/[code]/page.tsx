import { getSessionByCode } from '@/lib/actions/session'
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

  const currentUserId = user?.id ?? null
  const currentParticipant = session.participatesIns.find(
    (p) => p.participant_id === currentUserId
  )
  const currentRole = currentParticipant?.role ?? null
  const currentUsername = currentParticipant?.participant?.username ?? null

  // Serialize for client component
  const serialized = {
    id: session.id,
    code: session.code,
    name: session.name,
    type: session.type,
    status: session.status,
    turn_length: session.turn_length,
    max_participants: session.max_participants,
    moderator: session.moderator,
    participatesIns: session.participatesIns.map((p) => ({
      participant_id: p.participant_id,
      role: p.role,
      participant: p.participant,
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
