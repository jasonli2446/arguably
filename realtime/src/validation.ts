import { z } from "zod";

// ── Shared field schemas ──

const roomId = z.string().min(1).max(100);
const transportId = z.string().min(1).max(100);
const producerId = z.string().min(1).max(100);
const consumerId = z.string().min(1).max(100);
const displayName = z.string().min(1).max(50);

// Mediasoup-opaque objects: validate shape exists, don't deep-validate internals
const rtpCapabilities = z.record(z.string(), z.unknown());
const dtlsParameters = z.record(z.string(), z.unknown());
const rtpParameters = z.record(z.string(), z.unknown());

// ── Event payload schemas ──

export const schemas = {
  getRouterRtpCapabilities: z.object({
    roomId,
  }),

  joinRoom: z.object({
    roomId,
    displayName,
    rtpCapabilities,
  }),

  reconnect: z.object({
    roomId,
    stablePeerId: z.string().uuid(),
    displayName,
    rtpCapabilities,
  }),

  createWebRtcTransport: z.object({
    direction: z.enum(["send", "recv"]),
  }),

  connectTransport: z.object({
    transportId,
    dtlsParameters,
  }),

  produce: z.object({
    transportId,
    kind: z.enum(["audio", "video"]),
    rtpParameters,
    appData: z.record(z.string(), z.unknown()).optional(),
  }),

  consume: z.object({
    producerId,
  }),

  resumeConsumer: z.object({
    consumerId,
  }),

  closeProducer: z.object({
    producerId,
  }),

  getProducers: z.unknown(),
} as const;

// ── Validation helper ──

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export function validatePayload<T>(
  schema: z.ZodType<T>,
  data: unknown,
): ValidationResult<T> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const message = result.error.issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
  return { success: false, error: `Invalid payload: ${message}` };
}
