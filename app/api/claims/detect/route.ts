import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"
import { detectAndSaveClaims } from "@/lib/claims"

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/** Detects factual claims for an existing transcript segment after verifying session participation. */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return badRequest("Not authenticated", 401)
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return badRequest("Invalid JSON body")
  }

  const { segmentId, sessionId } = body as { segmentId?: string; sessionId?: string }

  if (!segmentId || !sessionId) {
    return badRequest("Missing segmentId or sessionId")
  }

  // Verify participation
  const participation = await prisma.participatesIn.findUnique({
    where: {
      user_id_session_id: {
        user_id: user.id,
        session_id: sessionId,
      },
    },
  })

  if (!participation || participation.left_at) {
    return badRequest("Not authorized for this session", 403)
  }

  // Fetch the segment to get text and speaker name
  const segment = await prisma.transcriptSegment.findUnique({
    where: { id: segmentId },
    select: { text: true, speaker_name: true, session_id: true },
  })

  if (!segment || segment.session_id !== sessionId) {
    return badRequest("Segment not found", 404)
  }

  const claims = await detectAndSaveClaims({
    segmentId,
    sessionId,
    text: segment.text,
    speakerName: segment.speaker_name,
  })

  return NextResponse.json({ claims })
}
