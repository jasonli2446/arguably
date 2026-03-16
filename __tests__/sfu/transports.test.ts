import { describe, it, expect, vi } from 'vitest'

vi.mock('../../realtime/src/config.js', () => ({
  webRtcTransportOptions: {
    listenInfos: [{ protocol: 'udp', ip: '0.0.0.0', announcedAddress: '127.0.0.1' }],
    initialAvailableOutgoingBitrate: 1_000_000,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  },
}))

import { getTransportOptions } from '../../realtime/src/mediasoup/transports.js'

describe('getTransportOptions', () => {
  it('extracts id, iceParameters, iceCandidates, and dtlsParameters', () => {
    const mockTransport = {
      id: 'transport-123',
      iceParameters: { usernameFragment: 'frag', password: 'pass', iceLite: true },
      iceCandidates: [{ foundation: '1', priority: 1, ip: '127.0.0.1', port: 40000, type: 'host', protocol: 'udp' }],
      dtlsParameters: { fingerprints: [{ algorithm: 'sha-256', value: 'abc' }], role: 'auto' },
    }

    const options = getTransportOptions(mockTransport as any)

    expect(options.id).toBe('transport-123')
    expect(options.iceParameters).toBe(mockTransport.iceParameters)
    expect(options.iceCandidates).toBe(mockTransport.iceCandidates)
    expect(options.dtlsParameters).toBe(mockTransport.dtlsParameters)
  })
})
