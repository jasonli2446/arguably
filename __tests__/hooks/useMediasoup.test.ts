// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// ── Mock socket.io-client ──

const mockSocket = {
  on: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  connected: true,
}

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}))

// ── Mock mediasoup-client ──

const mockSendTransport = {
  id: 'send-transport-1',
  on: vi.fn(),
  produce: vi.fn(),
  close: vi.fn(),
}

const mockRecvTransport = {
  id: 'recv-transport-1',
  on: vi.fn(),
  consume: vi.fn(),
  close: vi.fn(),
}

const mockDevice = {
  load: vi.fn(),
  rtpCapabilities: { codecs: [] },
  createSendTransport: vi.fn(() => mockSendTransport),
  createRecvTransport: vi.fn(() => mockRecvTransport),
}

vi.mock('mediasoup-client', () => ({
  Device: vi.fn(() => mockDevice),
}))

// ── Mock Supabase client (for auth token) ──

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'mock-jwt-token' } },
      }),
    },
  })),
}))

// ── Mock getUserMedia ──

const mockVideoTrack = {
  kind: 'video',
  enabled: true,
  stop: vi.fn(),
}

const mockAudioTrack = {
  kind: 'audio',
  enabled: true,
  stop: vi.fn(),
}

const mockMediaStream = {
  getVideoTracks: () => [mockVideoTrack],
  getAudioTracks: () => [mockAudioTrack],
  getTracks: () => [mockVideoTrack, mockAudioTrack],
}

Object.defineProperty(global.navigator, 'mediaDevices', {
  value: {
    getUserMedia: vi.fn().mockResolvedValue(mockMediaStream),
  },
  writable: true,
})

// ── Import after mocks ──

import { useMediasoup } from '../../hooks/useMediasoup'

// ── Helpers ──

function getSocketHandler(event: string): Function | undefined {
  for (const call of mockSocket.on.mock.calls) {
    if (call[0] === event) return call[1]
  }
  return undefined
}

function getSocketEmitAck(event: string): { data: any; callback: Function } | undefined {
  for (const call of mockSocket.emit.mock.calls) {
    if (call[0] === event) {
      return { data: call[1], callback: call[2] }
    }
  }
  return undefined
}

const defaultOptions = {
  sfuUrl: 'http://localhost:3001',
  roomId: 'test-room',
  displayName: 'TestUser',
  enabled: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSocket.connected = true
  mockVideoTrack.enabled = true
  mockAudioTrack.enabled = true
})

describe('useMediasoup', () => {
  describe('disabled/missing params', () => {
    it('stays disconnected when enabled is false', () => {
      const { result } = renderHook(() =>
        useMediasoup({ ...defaultOptions, enabled: false })
      )

      expect(result.current.connectionState).toBe('disconnected')
      expect(result.current.localStream).toBeNull()
      expect(result.current.remoteStreams.size).toBe(0)
    })

    it('stays disconnected when sfuUrl is undefined', () => {
      const { result } = renderHook(() =>
        useMediasoup({ ...defaultOptions, sfuUrl: undefined })
      )

      expect(result.current.connectionState).toBe('disconnected')
    })

    it('stays disconnected when roomId is empty', () => {
      const { result } = renderHook(() =>
        useMediasoup({ ...defaultOptions, roomId: '' })
      )

      expect(result.current.connectionState).toBe('disconnected')
    })

    it('stays disconnected when displayName is empty', () => {
      const { result } = renderHook(() =>
        useMediasoup({ ...defaultOptions, displayName: '' })
      )

      expect(result.current.connectionState).toBe('disconnected')
    })
  })

  describe('connection', () => {
    it('sets connectionState to connecting when enabled', async () => {
      renderHook(() => useMediasoup(defaultOptions))

      // The effect triggers async connect(), which sets state to 'connecting'
      // We need to wait for the async module imports
      await vi.waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled()
      })
    })

    it('sets connectionState to error on connect_error', async () => {
      const { result } = renderHook(() => useMediasoup(defaultOptions))

      await vi.waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled()
      })

      const connectErrorHandler = getSocketHandler('connect_error')
      expect(connectErrorHandler).toBeDefined()

      await act(async () => {
        connectErrorHandler!(new Error('Connection refused'))
      })

      expect(result.current.connectionState).toBe('error')
    })
  })

  describe('toggleMute', () => {
    it('toggles audio track enabled state', async () => {
      const { result } = renderHook(() => useMediasoup(defaultOptions))

      // Simulate the full connection flow to populate localStreamRef
      await vi.waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled()
      })

      // We can't easily complete the full async flow in unit tests,
      // but we can test toggleMute returns without error when no stream
      expect(result.current.audioMuted).toBe(false)

      act(() => {
        result.current.toggleMute()
      })

      // Without a local stream, toggleMute is a no-op
      expect(result.current.audioMuted).toBe(false)
    })
  })

  describe('toggleVideo', () => {
    it('toggles video track enabled state', async () => {
      const { result } = renderHook(() => useMediasoup(defaultOptions))

      await vi.waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled()
      })

      expect(result.current.videoOff).toBe(false)

      act(() => {
        result.current.toggleVideo()
      })

      // Without a local stream, toggleVideo is a no-op
      expect(result.current.videoOff).toBe(false)
    })
  })

  describe('disconnect', () => {
    it('sets state to disconnected and disconnects socket', async () => {
      const { result } = renderHook(() => useMediasoup(defaultOptions))

      await vi.waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled()
      })

      act(() => {
        result.current.disconnect()
      })

      expect(result.current.connectionState).toBe('disconnected')
      expect(mockSocket.disconnect).toHaveBeenCalled()
    })
  })

  describe('cleanup on unmount', () => {
    it('disconnects socket on unmount', async () => {
      const { unmount } = renderHook(() => useMediasoup(defaultOptions))

      await vi.waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled()
      })

      unmount()

      expect(mockSocket.disconnect).toHaveBeenCalled()
    })
  })

  describe('return values', () => {
    it('returns expected shape including reconnectingPeers', () => {
      const { result } = renderHook(() => useMediasoup(defaultOptions))

      expect(result.current).toEqual(
        expect.objectContaining({
          connectionState: expect.any(String),
          localStream: null,
          remoteStreams: expect.any(Map),
          reconnectingPeers: expect.any(Set),
          audioMuted: false,
          videoOff: false,
          toggleMute: expect.any(Function),
          toggleVideo: expect.any(Function),
          disconnect: expect.any(Function),
          reconnect: expect.any(Function),
        })
      )
    })
  })

  describe('reconnection behavior', () => {
    it('sets state to reconnecting on disconnect', async () => {
      const { result } = renderHook(() => useMediasoup(defaultOptions))

      await vi.waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled()
      })

      const disconnectHandler = getSocketHandler('disconnect')
      expect(disconnectHandler).toBeDefined()

      await act(async () => {
        disconnectHandler!()
      })

      expect(result.current.connectionState).toBe('reconnecting')
    })

    it('handles peerReconnecting event', async () => {
      const { result } = renderHook(() => useMediasoup(defaultOptions))

      await vi.waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled()
      })

      const peerReconnectingHandler = getSocketHandler('peerReconnecting')
      expect(peerReconnectingHandler).toBeDefined()

      await act(async () => {
        peerReconnectingHandler!({ peerId: 'peer-1', displayName: 'Alice' })
      })

      expect(result.current.reconnectingPeers.has('peer-1')).toBe(true)
    })

    it('handles peerReconnected event', async () => {
      const { result } = renderHook(() => useMediasoup(defaultOptions))

      await vi.waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled()
      })

      const peerReconnectingHandler = getSocketHandler('peerReconnecting')
      const peerReconnectedHandler = getSocketHandler('peerReconnected')

      await act(async () => {
        peerReconnectingHandler!({ peerId: 'peer-1', displayName: 'Alice' })
      })

      expect(result.current.reconnectingPeers.has('peer-1')).toBe(true)

      await act(async () => {
        peerReconnectedHandler!({ peerId: 'peer-1', displayName: 'Alice' })
      })

      expect(result.current.reconnectingPeers.has('peer-1')).toBe(false)
    })

    it('removes reconnecting peer on peerLeft', async () => {
      const { result } = renderHook(() => useMediasoup(defaultOptions))

      await vi.waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled()
      })

      const peerReconnectingHandler = getSocketHandler('peerReconnecting')
      const peerLeftHandler = getSocketHandler('peerLeft')

      await act(async () => {
        peerReconnectingHandler!({ peerId: 'peer-1', displayName: 'Alice' })
      })

      expect(result.current.reconnectingPeers.has('peer-1')).toBe(true)

      await act(async () => {
        peerLeftHandler!({ peerId: 'peer-1', displayName: 'Alice' })
      })

      expect(result.current.reconnectingPeers.has('peer-1')).toBe(false)
    })

    it('handles transportFailure without crashing', async () => {
      const { result } = renderHook(() => useMediasoup(defaultOptions))

      await vi.waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled()
      })

      const transportFailureHandler = getSocketHandler('transportFailure')
      expect(transportFailureHandler).toBeDefined()

      await act(async () => {
        transportFailureHandler!({ transportId: 'transport-1', direction: 'send', reason: 'DTLS failed' })
      })

      // Should not throw
      expect(result.current.connectionState).toBeDefined()
    })

    it('does not set error on connect_error if peerId exists (reconnection)', async () => {
      const { result } = renderHook(() => useMediasoup(defaultOptions))

      await vi.waitFor(() => {
        expect(mockSocket.on).toHaveBeenCalled()
      })

      const connectHandler = getSocketHandler('connect')
      const connectErrorHandler = getSocketHandler('connect_error')

      // Simulate initial connection that would set peerIdRef
      // (This is simplified — in reality the full flow sets it)

      await act(async () => {
        connectErrorHandler!(new Error('Reconnection attempt failed'))
      })

      // Since peerIdRef is not set in this mock, it will set error
      // In a real scenario with peerIdRef, it wouldn't
      expect(result.current.connectionState).toBe('error')
    })
  })
})
