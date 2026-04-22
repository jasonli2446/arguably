export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getReplayData } from '@/lib/actions/replay'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { SessionStatus } from '@/lib/generated/prisma'
import ReplayClient from './ReplayClient'

export default async function ReplayPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params

  // Check auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.id) {
    redirect('/auth')
  }

  // Check session exists and is ENDED
  const session = await prisma.session.findUnique({
    where: { code },
    select: { status: true },
  })

  if (!session) {
    notFound()
  }

  if (session.status !== SessionStatus.ENDED) {
    redirect(`/room/${code}`)
  }

  // Fetch all replay data server-side
  const replayData = await getReplayData(code)

  return <ReplayClient data={replayData} />
}
