import { prisma } from "@/lib/prisma"

// ── Interfaces ──

/** Source reference attached to a detected factual claim. */
export interface SourceView {
  title: string
  url: string
  description: string
}

/** Client-safe view of a detected claim and its fact-check analysis. */
export interface ClaimView {
  id: string
  sessionId: string
  transcriptSegmentId: string
  speakerName: string
  claimText: string
  analysis: string
  confidence: number
  sources: SourceView[]
  provider: string
  providerModel: string
  createdAt: string
}

/** Input required to persist a detected claim. */
export interface SaveClaimInput {
  sessionId: string
  transcriptSegmentId: string
  claimText: string
  analysis: string
  confidence: number
  sources: SourceView[]
  provider: string
  providerModel: string
}

// ── Mapping ──

function toClaimView(claim: {
  id: string
  session_id: string
  transcript_segment_id: string
  claim_text: string
  analysis: string
  confidence: number
  sources: unknown
  provider: string
  provider_model: string
  created_at: Date
  segment: { speaker_name: string }
}): ClaimView {
  return {
    id: claim.id,
    sessionId: claim.session_id,
    transcriptSegmentId: claim.transcript_segment_id,
    speakerName: claim.segment.speaker_name,
    claimText: claim.claim_text,
    analysis: claim.analysis,
    confidence: claim.confidence,
    sources: validateSources(claim.sources),
    provider: claim.provider,
    providerModel: claim.provider_model,
    createdAt: claim.created_at.toISOString(),
  }
}

// ── Source Validation ──

const URL_PATTERN = /^https?:\/\//

function validateSources(raw: unknown): SourceView[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (s): s is SourceView =>
      s != null &&
      typeof s === "object" &&
      typeof s.title === "string" &&
      typeof s.url === "string" &&
      typeof s.description === "string" &&
      URL_PATTERN.test(s.url),
  )
}

// ── Data Access ──

/** Lists detected claims for a session in creation order. */
export async function listClaims(sessionId: string): Promise<ClaimView[]> {
  const claims = await prisma.detectedClaim.findMany({
    where: { session_id: sessionId },
    orderBy: { created_at: "asc" },
    include: { segment: { select: { speaker_name: true } } },
  })
  return claims.map(toClaimView)
}

/** Persists one detected claim and returns it in client view form. */
export async function saveClaim(input: SaveClaimInput): Promise<ClaimView> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const claim = await (prisma.detectedClaim.create as any)({
    data: {
      session_id: input.sessionId,
      transcript_segment_id: input.transcriptSegmentId,
      claim_text: input.claimText,
      analysis: input.analysis,
      confidence: input.confidence,
      sources: input.sources,
      provider: input.provider,
      provider_model: input.providerModel,
    },
    include: { segment: { select: { speaker_name: true } } },
  })
  return toClaimView(claim)
}

// ── Gemini Claim Detection ──

/** Input required to run claim detection for one transcript segment. */
export interface DetectClaimsInput {
  segmentId: string
  sessionId: string
  text: string
  speakerName: string
}

interface GeminiClaim {
  claimText: string
  analysis: string
  confidence: number
  sources: { title: string; url: string; description: string }[]
}

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
const DETECT_TIMEOUT_MS = 10_000

/** Runs Gemini claim detection for a transcript segment and stores qualifying claims. */
export async function detectAndSaveClaims(input: DetectClaimsInput): Promise<ClaimView[]> {
  const { segmentId, sessionId, text } = input

  try {
    // Dedup guard: skip if claims already exist for this segment
    const existing = await prisma.detectedClaim.count({
      where: { transcript_segment_id: segmentId },
    })
    if (existing > 0) return []

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return []

    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash"
    const threshold = parseFloat(process.env.GEMINI_CONFIDENCE_THRESHOLD || "0.7")

    // Fetch previous segment for context continuity
    const prevSegment = await prisma.transcriptSegment.findFirst({
      where: { session_id: sessionId, id: { not: segmentId } },
      orderBy: { started_at: "desc" },
      select: { text: true },
    })

    const contextText = prevSegment
      ? `Previous context: ${prevSegment.text}\n\nCurrent segment: ${text}`
      : `Current segment: ${text}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS)

    const response = await fetch(
      `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "You are a fact-checker for a live debate. Analyze the transcript and identify any verifiable factual claims (statistics, historical facts, scientific claims, etc.). For each claim, provide the exact claim text from the transcript, a brief analysis of its accuracy, a confidence score (0.0-1.0) indicating how certain you are this is a verifiable factual claim, and up to 3 relevant source references. Return an empty claims array if no verifiable factual claims are present. Do not flag opinions, predictions, or subjective statements.",
            }],
          },
          contents: [{
            parts: [{ text: contextText }],
          }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                claims: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      claimText: { type: "STRING" },
                      analysis: { type: "STRING" },
                      confidence: { type: "NUMBER" },
                      sources: {
                        type: "ARRAY",
                        items: {
                          type: "OBJECT",
                          properties: {
                            title: { type: "STRING" },
                            url: { type: "STRING" },
                            description: { type: "STRING" },
                          },
                          required: ["title", "url", "description"],
                        },
                      },
                    },
                    required: ["claimText", "analysis", "confidence", "sources"],
                  },
                },
              },
              required: ["claims"],
            },
          },
        }),
      },
    )

    clearTimeout(timeoutId)

    if (!response.ok) {
      console.error(`[claim-detection] Gemini API error: ${response.status} for session=${sessionId} segment=${segmentId}`)
      return []
    }

    const json = await response.json()
    const responseText = json?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!responseText) return []

    let parsed: { claims: GeminiClaim[] }
    try {
      parsed = JSON.parse(responseText)
    } catch {
      console.error(`[claim-detection] Failed to parse Gemini JSON for session=${sessionId} segment=${segmentId}`)
      return []
    }

    if (!Array.isArray(parsed.claims) || parsed.claims.length === 0) {
      return []
    }

    // Filter by confidence threshold and save
    const qualifyingClaims = parsed.claims.filter((c) => c.confidence >= threshold)
    const savedClaims: ClaimView[] = []

    for (const claim of qualifyingClaims) {
      const validatedSources = validateSources(claim.sources)
      const saved = await saveClaim({
        sessionId,
        transcriptSegmentId: segmentId,
        claimText: claim.claimText,
        analysis: claim.analysis,
        confidence: claim.confidence,
        sources: validatedSources,
        provider: "gemini",
        providerModel: model,
      })
      savedClaims.push(saved)
    }

    return savedClaims
  } catch (error) {
    console.error(`[claim-detection] Error for session=${sessionId} segment=${segmentId}:`, error)
    return []
  }
}
