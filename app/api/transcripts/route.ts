import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"
import { saveTranscriptSegment } from "@/lib/transcripts"
import { detectAndSaveClaims } from "@/lib/claims"
import { SessionRole, SessionStatus } from "@/lib/generated/prisma"

const MAX_AUDIO_BYTES = 4 * 1024 * 1024

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return badRequest("Not authenticated", 401)
  }

  const formData = await request.formData()
  const sessionId = formData.get("sessionId")
  const chunkIndex = formData.get("chunkIndex")
  const startedAt = formData.get("startedAt")
  const endedAt = formData.get("endedAt")
  const audioFile = formData.get("audio")

  if (typeof sessionId !== "string" || !sessionId) {
    return badRequest("Missing sessionId")
  }

  if (typeof chunkIndex !== "string" || Number.isNaN(Number(chunkIndex))) {
    return badRequest("Missing chunkIndex")
  }

  if (typeof startedAt !== "string" || Number.isNaN(Number(startedAt))) {
    return badRequest("Missing startedAt")
  }

  if (typeof endedAt !== "string" || Number.isNaN(Number(endedAt))) {
    return badRequest("Missing endedAt")
  }

  if (!(audioFile instanceof File)) {
    return badRequest("Missing audio chunk")
  }

  if (audioFile.size === 0) {
    return NextResponse.json({ skipped: true })
  }

  if (audioFile.size > MAX_AUDIO_BYTES) {
    return badRequest("Audio chunk too large")
  }

  const participation = await prisma.participatesIn.findUnique({
    where: {
      user_id_session_id: {
        user_id: user.id,
        session_id: sessionId,
      },
    },
    include: {
      user: {
        select: {
          username: true,
          realname: true,
        },
      },
      session: {
        select: {
          status: true,
        },
      },
    },
  })

  if (!participation || participation.left_at) {
    return badRequest("Not authorized for this room", 403)
  }

  if (
    participation.session_role !== SessionRole.DEBATER &&
    participation.session_role !== SessionRole.HOST
  ) {
    return badRequest("Only active debaters can transcribe", 403)
  }

  if (participation.session.status === SessionStatus.ENDED) {
    return badRequest("Session has ended", 409)
  }

  const openAiApiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe"

  if (!openAiApiKey) {
    return badRequest("OPENAI_API_KEY is not configured", 500)
  }

  const WHISPER_PROMPT = "This is a live debate discussion. Speakers present arguments, counterarguments, and evidence on various topics."

  const upstreamForm = new FormData()
  upstreamForm.append("model", model)
  upstreamForm.append("file", audioFile, audioFile.name || `chunk-${chunkIndex}.webm`)
  upstreamForm.append("language", "en")
  upstreamForm.append("prompt", WHISPER_PROMPT)

  const upstreamResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
    },
    body: upstreamForm,
  })

  const upstreamJson = await upstreamResponse.json().catch(() => null)

  if (!upstreamResponse.ok) {
    const errorMessage =
      upstreamJson &&
      typeof upstreamJson === "object" &&
      "error" in upstreamJson &&
      upstreamJson.error &&
      typeof upstreamJson.error === "object" &&
      "message" in upstreamJson.error &&
      typeof upstreamJson.error.message === "string"
        ? upstreamJson.error.message
        : "OpenAI transcription failed"

    return badRequest(errorMessage, upstreamResponse.status)
  }

  const text =
    upstreamJson &&
    typeof upstreamJson === "object" &&
    "text" in upstreamJson &&
    typeof upstreamJson.text === "string"
      ? upstreamJson.text.trim()
      : ""

  if (!text || text === WHISPER_PROMPT) {
    return NextResponse.json({ skipped: true })
  }

  const savedSegment = await saveTranscriptSegment({
    sessionId,
    speakerId: user.id,
    speakerName: participation.user.realname || participation.user.username,
    text,
    chunkIndex: Number(chunkIndex),
    startedAt: new Date(Number(startedAt)),
    endedAt: new Date(Number(endedAt)),
    provider: "openai",
    providerModel: model,
  })

  // Fire-and-forget claim detection (only if Gemini API key is configured)
  if (process.env.GEMINI_API_KEY) {
    detectAndSaveClaims({
      segmentId: savedSegment.id,
      sessionId,
      text: savedSegment.text,
      speakerName: savedSegment.speakerName,
    }).catch((err) => console.error("[claim-detection] Fire-and-forget failed:", err))
  }

  return NextResponse.json({
    segment: savedSegment,
  })
}
