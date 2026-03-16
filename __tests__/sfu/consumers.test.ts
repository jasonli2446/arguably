import { describe, it, expect, vi } from 'vitest'
import { createConsumer } from '../../realtime/src/mediasoup/consumers.js'

describe('createConsumer', () => {
  it('throws if router cannot consume', async () => {
    const mockRouter = {
      canConsume: vi.fn().mockReturnValue(false),
    }
    const mockTransport = { consume: vi.fn() }

    await expect(
      createConsumer(mockRouter as any, mockTransport as any, 'prod-1', {} as any)
    ).rejects.toThrow('Cannot consume: incompatible RTP capabilities')

    expect(mockTransport.consume).not.toHaveBeenCalled()
  })

  it('creates consumer in paused state when canConsume is true', async () => {
    const mockConsumer = { id: 'consumer-1', kind: 'audio' }
    const mockRouter = {
      canConsume: vi.fn().mockReturnValue(true),
    }
    const mockTransport = {
      consume: vi.fn().mockResolvedValue(mockConsumer),
    }
    const rtpCaps = { codecs: [] } as any

    const result = await createConsumer(mockRouter as any, mockTransport as any, 'prod-1', rtpCaps)

    expect(mockRouter.canConsume).toHaveBeenCalledWith({
      producerId: 'prod-1',
      rtpCapabilities: rtpCaps,
    })
    expect(mockTransport.consume).toHaveBeenCalledWith({
      producerId: 'prod-1',
      rtpCapabilities: rtpCaps,
      paused: true,
    })
    expect(result).toBe(mockConsumer)
  })
})
