'use client'

import { SessionStatus, SessionType } from '@/lib/generated/prisma'

type Session = {
  id: string
  code: string
  name: string
  type: SessionType
  status: SessionStatus
  createdAt: string
  debaterCapacityProponent: number | null
  debaterCapacityOpponent: number | null
  debaterCapacityPanel: number | null
  audienceCapacity: number
  turnLength: number
  moderator: {
    username: string
  } | null
  _count: {
    participates_ins: number
  }
}

type BrowseClientProps = {
  sessions: Session[]
}

export default function BrowseClient({ sessions }: BrowseClientProps) {
  return (
    <div>
      {sessions.map((s) => (
        <div key={s.id}>{s.name}</div>
      ))}
    </div>
  )
}