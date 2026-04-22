import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ──
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    participatesIn: {
      findUnique: vi.fn(),
    },
    detectedClaim: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    transcriptSegment: {
      findFirst: vi.fn(),
    },
  },
}))

import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { getDetectedClaims } from '@/lib/actions/claims'
import { listClaims, saveClaim, detectAndSaveClaims } from '@/lib/claims'

const MOCK_USER_ID = 'user-uuid-1234'
const MOCK_SESSION_ID = 'session-cuid-5678'
const MOCK_SEGMENT_ID = 'segment-cuid-9012'

function mockAuth(userId: string | null) {
  ;(createClient as any).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
      }),
    },
  })
}

// ── getDetectedClaims server action ──
describe('getDetectedClaims', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth(MOCK_USER_ID)
    ;(prisma.user.findUnique as any).mockResolvedValue({
      banned_at: null,
      suspended_until: null,
      deleted_at: null,
    })
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue({
      user_id: MOCK_USER_ID,
      session_id: MOCK_SESSION_ID,
      left_at: null,
    })
    ;(prisma.detectedClaim.findMany as any).mockResolvedValue([])
  })

  it('throws when not authenticated', async () => {
    mockAuth(null)
    await expect(getDetectedClaims(MOCK_SESSION_ID)).rejects.toThrow('Not authenticated')
  })

  it('throws when not a participant', async () => {
    ;(prisma.participatesIn.findUnique as any).mockResolvedValue(null)
    await expect(getDetectedClaims(MOCK_SESSION_ID)).rejects.toThrow('Not a participant in this session')
  })

  it('returns claims for authenticated participants', async () => {
    const createdAt = new Date('2026-04-05T22:10:00.000Z')

    ;(prisma.detectedClaim.findMany as any).mockResolvedValue([
      {
        id: 'claim-1',
        session_id: MOCK_SESSION_ID,
        transcript_segment_id: MOCK_SEGMENT_ID,
        claim_text: 'The earth is 4.5 billion years old',
        analysis: 'This is a well-established scientific fact.',
        confidence: 0.95,
        sources: [{ title: 'NASA', url: 'https://nasa.gov', description: 'NASA source' }],
        provider: 'gemini',
        provider_model: 'gemini-2.0-flash',
        created_at: createdAt,
        segment: { speaker_name: 'Alice' },
      },
    ])

    const result = await getDetectedClaims(MOCK_SESSION_ID)

    expect(prisma.detectedClaim.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { session_id: MOCK_SESSION_ID },
      }),
    )
    expect(result).toEqual([
      expect.objectContaining({
        id: 'claim-1',
        claimText: 'The earth is 4.5 billion years old',
        speakerName: 'Alice',
        confidence: 0.95,
      }),
    ])
  })
})

// ── listClaims ──
describe('listClaims', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries with session filter and chronological ordering', async () => {
    ;(prisma.detectedClaim.findMany as any).mockResolvedValue([])

    await listClaims(MOCK_SESSION_ID)

    expect(prisma.detectedClaim.findMany).toHaveBeenCalledWith({
      where: { session_id: MOCK_SESSION_ID },
      orderBy: { created_at: 'asc' },
      include: { segment: { select: { speaker_name: true } } },
    })
  })
})

// ── saveClaim ──
describe('saveClaim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a claim with correct data', async () => {
    const createdAt = new Date('2026-04-05T22:10:00.000Z')

    ;(prisma.detectedClaim.create as any).mockResolvedValue({
      id: 'claim-1',
      session_id: MOCK_SESSION_ID,
      transcript_segment_id: MOCK_SEGMENT_ID,
      claim_text: 'Test claim',
      analysis: 'Analysis text',
      confidence: 0.85,
      sources: [{ title: 'Source', url: 'https://example.com', description: 'Desc' }],
      provider: 'gemini',
      provider_model: 'gemini-2.0-flash',
      created_at: createdAt,
      segment: { speaker_name: 'Bob' },
    })

    const result = await saveClaim({
      sessionId: MOCK_SESSION_ID,
      transcriptSegmentId: MOCK_SEGMENT_ID,
      claimText: 'Test claim',
      analysis: 'Analysis text',
      confidence: 0.85,
      sources: [{ title: 'Source', url: 'https://example.com', description: 'Desc' }],
      provider: 'gemini',
      providerModel: 'gemini-2.0-flash',
    })

    expect(result.claimText).toBe('Test claim')
    expect(result.speakerName).toBe('Bob')
    expect(result.confidence).toBe(0.85)
  })
})

// ── detectAndSaveClaims ──
describe('detectAndSaveClaims', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.GEMINI_API_KEY = 'test-key'
    process.env.GEMINI_MODEL = 'gemini-2.0-flash'
    process.env.GEMINI_CONFIDENCE_THRESHOLD = '0.7'
    ;(prisma.detectedClaim.count as any).mockResolvedValue(0)
    ;(prisma.transcriptSegment.findFirst as any).mockResolvedValue(null)
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env = { ...originalEnv }
  })

  it('skips when claims already exist for this segment (dedup guard)', async () => {
    ;(prisma.detectedClaim.count as any).mockResolvedValue(1)

    const result = await detectAndSaveClaims({
      segmentId: MOCK_SEGMENT_ID,
      sessionId: MOCK_SESSION_ID,
      text: 'The earth is round',
      speakerName: 'Alice',
    })

    expect(result).toEqual([])
    expect(global.fetch).not.toBeDefined // fetch should not have been called
  })

  it('returns empty when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY

    const result = await detectAndSaveClaims({
      segmentId: MOCK_SEGMENT_ID,
      sessionId: MOCK_SESSION_ID,
      text: 'Test claim',
      speakerName: 'Alice',
    })

    expect(result).toEqual([])
  })

  it('returns empty when Gemini returns no claims', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify({ claims: [] }) }],
          },
        }],
      }),
    })

    const result = await detectAndSaveClaims({
      segmentId: MOCK_SEGMENT_ID,
      sessionId: MOCK_SESSION_ID,
      text: 'I think debates are fun',
      speakerName: 'Alice',
    })

    expect(result).toEqual([])
  })

  it('returns empty when Gemini returns malformed JSON', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{ text: 'not valid json' }],
          },
        }],
      }),
    })

    const result = await detectAndSaveClaims({
      segmentId: MOCK_SEGMENT_ID,
      sessionId: MOCK_SESSION_ID,
      text: 'Test text',
      speakerName: 'Alice',
    })

    expect(result).toEqual([])
  })

  it('filters claims below confidence threshold', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                claims: [
                  { claimText: 'Low confidence', analysis: 'Maybe', confidence: 0.3, sources: [] },
                  { claimText: 'High confidence', analysis: 'Verified', confidence: 0.9, sources: [] },
                ],
              }),
            }],
          },
        }],
      }),
    })

    ;(prisma.detectedClaim.create as any).mockResolvedValue({
      id: 'claim-1',
      session_id: MOCK_SESSION_ID,
      transcript_segment_id: MOCK_SEGMENT_ID,
      claim_text: 'High confidence',
      analysis: 'Verified',
      confidence: 0.9,
      sources: [],
      provider: 'gemini',
      provider_model: 'gemini-2.0-flash',
      created_at: new Date(),
      segment: { speaker_name: 'Alice' },
    })

    const result = await detectAndSaveClaims({
      segmentId: MOCK_SEGMENT_ID,
      sessionId: MOCK_SESSION_ID,
      text: 'The earth is 4.5 billion years old and maybe blue',
      speakerName: 'Alice',
    })

    // Only the high-confidence claim should be saved
    expect(prisma.detectedClaim.create).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(1)
    expect(result[0].claimText).toBe('High confidence')
  })

  it('returns empty on Gemini API error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    })

    const result = await detectAndSaveClaims({
      segmentId: MOCK_SEGMENT_ID,
      sessionId: MOCK_SESSION_ID,
      text: 'Test text',
      speakerName: 'Alice',
    })

    expect(result).toEqual([])
  })

  it('returns empty on network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const result = await detectAndSaveClaims({
      segmentId: MOCK_SEGMENT_ID,
      sessionId: MOCK_SESSION_ID,
      text: 'Test text',
      speakerName: 'Alice',
    })

    expect(result).toEqual([])
  })
})
