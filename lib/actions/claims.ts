"use server"

import { requireParticipant } from "@/lib/actions/utils"
import { listClaims } from "@/lib/claims"

/** Returns detected claims for a session after confirming current participation. */
export async function getDetectedClaims(sessionId: string) {
  await requireParticipant(sessionId)

  return listClaims(sessionId)
}
