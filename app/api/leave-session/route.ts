import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"
import { SessionRole } from "@/lib/generated/prisma"
import { doPromoteFromQueue, cleanupUserVotes } from "@/lib/actions/queue"
import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const { sessionId } = await req.json()
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 })

  const participation = await prisma.participatesIn.findUnique({
    where: {
      user_id_session_id: { user_id: user.id, session_id: sessionId },
    },
  })
  if (!participation) return NextResponse.json({ error: "Not a participant" }, { status: 400 })

  const wasDebater = participation.session_role === SessionRole.DEBATER

  await prisma.$transaction(async (tx) => {
    await tx.participatesIn.update({
      where: {
        user_id_session_id: { user_id: user.id, session_id: sessionId },
      },
      data: { left_at: new Date() },
    })

    // Remove from queue
    await tx.audienceQueue.deleteMany({
      where: { session_id: sessionId, user_id: user.id },
    })

    // Clean up votes
    await cleanupUserVotes(tx, sessionId, user.id)

    // If was debater, remove from debater_order and auto-promote
    if (wasDebater) {
      const state = await tx.debateState.findUnique({
        where: { session_id: sessionId },
      })
      if (state) {
        const order = state.debater_order as { userId: string; displayName: string }[]
        const removedIndex = order.findIndex((d) => d.userId === user.id)
        const newOrder = order.filter((d) => d.userId !== user.id)
        let newIndex = state.current_index
        if (removedIndex < state.current_index) {
          newIndex = Math.max(0, newIndex - 1)
        } else if (removedIndex === state.current_index && newOrder.length > 0) {
          newIndex = newIndex % newOrder.length
        }
        await tx.debateState.update({
          where: { session_id: sessionId },
          data: { debater_order: newOrder, current_index: newIndex },
        })
      }

      await doPromoteFromQueue(tx, sessionId)
    }
  })

  return NextResponse.json({ success: true })
}
