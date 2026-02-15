import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { sessionId } = await req.json()
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 })

  await prisma.participatesIn.update({
    where: {
      participant_id_session_id: {
        participant_id: user.id,
        session_id: sessionId,
      },
    },
    data: { left_at: new Date() },
  })

  return NextResponse.json({ success: true })
}
