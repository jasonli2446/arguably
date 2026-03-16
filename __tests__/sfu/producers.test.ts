import { describe, it, expect, vi } from 'vitest'
import { createProducer } from '../../realtime/src/mediasoup/producers.js'

describe('createProducer', () => {
  it('calls transport.produce with correct parameters', async () => {
    const mockProducer = { id: 'producer-1', kind: 'audio' }
    const mockTransport = {
      produce: vi.fn().mockResolvedValue(mockProducer),
    }
    const rtpParams = { codecs: [], headerExtensions: [], encodings: [] } as any

    const result = await createProducer(mockTransport as any, 'audio', rtpParams, { source: 'mic' })

    expect(mockTransport.produce).toHaveBeenCalledWith({
      kind: 'audio',
      rtpParameters: rtpParams,
      appData: { source: 'mic' },
    })
    expect(result).toBe(mockProducer)
  })

  it('defaults appData to empty object when not provided', async () => {
    const mockProducer = { id: 'producer-2', kind: 'video' }
    const mockTransport = {
      produce: vi.fn().mockResolvedValue(mockProducer),
    }

    await createProducer(mockTransport as any, 'video', {} as any)

    expect(mockTransport.produce).toHaveBeenCalledWith({
      kind: 'video',
      rtpParameters: {},
      appData: {},
    })
  })
})
