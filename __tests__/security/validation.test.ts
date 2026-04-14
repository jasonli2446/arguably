import { describe, it, expect } from 'vitest'
import { schemas, validatePayload } from '../../realtime/src/validation'

// ── validatePayload helper ──
describe('validatePayload', () => {
  it('returns success with parsed data for valid input', () => {
    const result = validatePayload(schemas.getRouterRtpCapabilities, { roomId: 'room-1' })
    expect(result).toEqual({ success: true, data: { roomId: 'room-1' } })
  })

  it('returns error string for invalid input', () => {
    const result = validatePayload(schemas.getRouterRtpCapabilities, {})
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('Invalid payload')
    }
  })

  it('returns error for completely wrong type', () => {
    const result = validatePayload(schemas.getRouterRtpCapabilities, 'not-an-object')
    expect(result.success).toBe(false)
  })
})

// ── getRouterRtpCapabilities schema ──
describe('schemas.getRouterRtpCapabilities', () => {
  it('accepts valid roomId', () => {
    const result = schemas.getRouterRtpCapabilities.safeParse({ roomId: 'room-123' })
    expect(result.success).toBe(true)
  })

  it('rejects missing roomId', () => {
    const result = schemas.getRouterRtpCapabilities.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects empty roomId', () => {
    const result = schemas.getRouterRtpCapabilities.safeParse({ roomId: '' })
    expect(result.success).toBe(false)
  })

  it('rejects roomId exceeding 100 chars', () => {
    const result = schemas.getRouterRtpCapabilities.safeParse({ roomId: 'a'.repeat(101) })
    expect(result.success).toBe(false)
  })
})

// ── joinRoom schema ──
describe('schemas.joinRoom', () => {
  const validPayload = {
    roomId: 'room-1',
    displayName: 'Alice',
    rtpCapabilities: { codecs: [] },
  }

  it('accepts valid payload', () => {
    const result = schemas.joinRoom.safeParse(validPayload)
    expect(result.success).toBe(true)
  })

  it('rejects missing displayName', () => {
    const result = schemas.joinRoom.safeParse({ roomId: 'room-1', rtpCapabilities: {} })
    expect(result.success).toBe(false)
  })

  it('rejects displayName exceeding 50 chars', () => {
    const result = schemas.joinRoom.safeParse({
      ...validPayload,
      displayName: 'a'.repeat(51),
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing rtpCapabilities', () => {
    const result = schemas.joinRoom.safeParse({ roomId: 'room-1', displayName: 'Alice' })
    expect(result.success).toBe(false)
  })
})

// ── createWebRtcTransport schema ──
describe('schemas.createWebRtcTransport', () => {
  it('accepts "send" direction', () => {
    const result = schemas.createWebRtcTransport.safeParse({ direction: 'send' })
    expect(result.success).toBe(true)
  })

  it('accepts "recv" direction', () => {
    const result = schemas.createWebRtcTransport.safeParse({ direction: 'recv' })
    expect(result.success).toBe(true)
  })

  it('rejects invalid direction', () => {
    const result = schemas.createWebRtcTransport.safeParse({ direction: 'both' })
    expect(result.success).toBe(false)
  })

  it('rejects missing direction', () => {
    const result = schemas.createWebRtcTransport.safeParse({})
    expect(result.success).toBe(false)
  })
})

// ── connectTransport schema ──
describe('schemas.connectTransport', () => {
  it('accepts valid payload', () => {
    const result = schemas.connectTransport.safeParse({
      transportId: 'transport-1',
      dtlsParameters: { fingerprints: [] },
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing transportId', () => {
    const result = schemas.connectTransport.safeParse({ dtlsParameters: {} })
    expect(result.success).toBe(false)
  })

  it('rejects missing dtlsParameters', () => {
    const result = schemas.connectTransport.safeParse({ transportId: 'transport-1' })
    expect(result.success).toBe(false)
  })
})

// ── produce schema ──
describe('schemas.produce', () => {
  const validPayload = {
    transportId: 'transport-1',
    kind: 'audio' as const,
    rtpParameters: { codecs: [] },
  }

  it('accepts valid payload with audio kind', () => {
    const result = schemas.produce.safeParse(validPayload)
    expect(result.success).toBe(true)
  })

  it('accepts valid payload with video kind', () => {
    const result = schemas.produce.safeParse({ ...validPayload, kind: 'video' })
    expect(result.success).toBe(true)
  })

  it('rejects invalid kind', () => {
    const result = schemas.produce.safeParse({ ...validPayload, kind: 'data' })
    expect(result.success).toBe(false)
  })

  it('accepts optional appData', () => {
    const result = schemas.produce.safeParse({ ...validPayload, appData: { source: 'webcam' } })
    expect(result.success).toBe(true)
  })

  it('rejects missing rtpParameters', () => {
    const result = schemas.produce.safeParse({ transportId: 'transport-1', kind: 'audio' })
    expect(result.success).toBe(false)
  })
})

// ── consume schema ──
describe('schemas.consume', () => {
  it('accepts valid producerId', () => {
    const result = schemas.consume.safeParse({ producerId: 'prod-1' })
    expect(result.success).toBe(true)
  })

  it('rejects missing producerId', () => {
    const result = schemas.consume.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects empty producerId', () => {
    const result = schemas.consume.safeParse({ producerId: '' })
    expect(result.success).toBe(false)
  })
})

// ── resumeConsumer schema ──
describe('schemas.resumeConsumer', () => {
  it('accepts valid consumerId', () => {
    const result = schemas.resumeConsumer.safeParse({ consumerId: 'cons-1' })
    expect(result.success).toBe(true)
  })

  it('rejects missing consumerId', () => {
    const result = schemas.resumeConsumer.safeParse({})
    expect(result.success).toBe(false)
  })
})

// ── closeProducer schema ──
describe('schemas.closeProducer', () => {
  it('accepts valid producerId', () => {
    const result = schemas.closeProducer.safeParse({ producerId: 'prod-1' })
    expect(result.success).toBe(true)
  })

  it('rejects missing producerId', () => {
    const result = schemas.closeProducer.safeParse({})
    expect(result.success).toBe(false)
  })
})

// ── getProducers schema ──
describe('schemas.getProducers', () => {
  it('accepts any data (no strict schema)', () => {
    const result = schemas.getProducers.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts undefined', () => {
    const result = schemas.getProducers.safeParse(undefined)
    expect(result.success).toBe(true)
  })
})
