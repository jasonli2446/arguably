"use server"

import { prisma } from "@/lib/prisma"
import { requireAuth, requireHostOrModerator, requireParticipant } from "@/lib/actions/utils"

export async function createRecording(
  sessionId: string,
  url: string,
  duration?: number,
  fileSize?: number,
  mimeType?: string
) {
  const { user } = await requireHostOrModerator(sessionId)

  return await prisma.recording.create({
    data: {
      session_id: sessionId,
      recorded_by: user.id,
      url,
      duration: duration ?? null,
      file_size: fileSize ?? null,
      mime_type: mimeType ?? null,
    },
  })
}

export async function getRecordingsBySession(sessionId: string) {
  await requireParticipant(sessionId)

  return await prisma.recording.findMany({
    where: { session_id: sessionId },
    orderBy: { created_at: "desc" },
    include: {
      recorder: { select: { id: true, username: true, realname: true } },
    },
  })
}

export async function deleteRecording(recordingId: string) {
  const user = await requireAuth()

  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    include: { session: { select: { host_id: true } } },
  })
  if (!recording) throw new Error("Recording not found")

  if (recording.recorded_by !== user.id && recording.session.host_id !== user.id) {
    throw new Error("Not authorized to delete this recording")
  }

  await prisma.recording.delete({ where: { id: recordingId } })
}
