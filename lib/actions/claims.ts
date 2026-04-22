"use server"

import { requireParticipant } from "@/lib/actions/utils"
import { listClaims } from "@/lib/claims"

export async function getDetectedClaims(sessionId: string) {
  await requireParticipant(sessionId)

  return listClaims(sessionId)
}
