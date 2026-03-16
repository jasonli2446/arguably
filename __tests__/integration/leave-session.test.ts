import { describe, it, expect, beforeEach } from "vitest"
import { prisma } from "@/lib/prisma"
import { POST } from "@/app/api/leave-session/route"
import { NextRequest } from "next/server"

const USER_ID = "test-user-1"
const SESSION_ID = "test-session-1"

describe("leave-session integration", () => {

  beforeEach(async () => {
    // clean database
    await prisma.participatesIn.deleteMany({
      where: { session_id: SESSION_ID },
    })

    // create participation record
    await prisma.participatesIn.create({
      data: {
        user_id: USER_ID,
        session_id: SESSION_ID,
        joined_at: new Date(),
        left_at: null,
      },
    })
  })

  it("updates left_at when user leaves session", async () => {

    const requestBody = {
      sessionId: SESSION_ID,
    }

    const req = new NextRequest("http://localhost/api/leave-session", {
      method: "POST",
      body: JSON.stringify(requestBody),
      headers: {
        "content-type": "application/json",
      },
    })

    // call API route
    const response = await POST(req)

    expect(response.status).toBe(200)

    // verify database updated
    const record = await prisma.participatesIn.findUnique({
      where: {
        user_id_session_id: {
          user_id: USER_ID,
          session_id: SESSION_ID,
        },
      },
    })

    expect(record).not.toBeNull()
    expect(record?.left_at).not.toBeNull()

    // ensure timestamp is recent
    const now = Date.now()
    const leftAt = record!.left_at!.getTime()

    expect(now - leftAt).toBeLessThan(5000)
  })
})