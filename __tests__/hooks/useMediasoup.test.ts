// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// ── Mocks ──

const mockSendTransport = {
  id: 'send-transport-id',
  on: vi.fn(),
  produce: vi.fn(),
  close: vi.fn(),
}

const mockRecvTransport = {
  id: 'recv-transport-id',
  on: vi.fn(),
  consume: vi.fn(),
  close: vi.fn(),
}

const mockDevice = {
  load: vi.fn(),
  loaded: false,
  rtpCapabilities: { codecs: [] },
  createSendTransport: vi.fn(() => mockSendTransport),
  createRecvTransport: vi.fn(() => mockRecvTransport),
}

const mockSocket = {
  on: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  connected: true,
}

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}))

vi.mock('mediasoup-client', () => ({
  Device: vi.fn(() => mockDevice),
}))

// ── Import after mocks ──

import { useMediasoup } from '../../hooks/useMediasoup'

// ── Helpers ──

function getSocketHandler(event: string): Function | undefined {
  for (const call of mockSocket.on.mock.calls) {
    if (call[0] === event) return call[1]
  }
  return undefined
}

// ── Tests ──

describe('useMediasoup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDevice.loaded = false
    mockSocket.connected = true

    // Default: emit with ack returns success
    mockSocket.emit.mockImplementation((event: string, data: any, callback?: Function) => {
      if (callback) {
        // Default responses
        if (event === 'getRouterRtpCapabilities') {
          callback({ success: true, rtpCapabilities: { codecs: [] }, iceServers: [] })
        } else if (event === 'joinRoom') {
          callback({ success: true, stablePeerId: 'stable-peer-123' })
        } else if (event === 'createWebRtcTransport') {
          callback({
            success: true,
            transportOptions: {
              id: data.direction === 'send' ? 'send-transport-id' : 'recv-transport-id',
              iceParameters: {},
              iceCandidates: [],
              dtlsParameters: {},
            },
          })
        } else if (event === 'getProducers') {
          callback({ success: true, producers: [] })
        } else {
          callback({ success: true })
        }
      }
    })

    mockSendTransport.produce.mockResolvedValue({
      id: 'producer-id',
      close: vi.fn(),
    })

    mockRecvTransport.consume.mockResolvedValue({
      id: 'consumer-id',
      track: { kind: 'audio', enabled: true },
      close: vi.fn(),
      producerId: 'remote-producer-id',
    })

    // Mock getUserMedia
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getVideoTracks: () => [{ readyState: 'live', enabled: true }],
          getAudioTracks: () => [{ readyState: 'live', enabled: true }],
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
      configurable: true,
    })
  })

  // ────────────────────────────────────────────────────────────────────
  // Existing tests (updated for new shape)
  // ────────────────────────────────────────────────────────────────────

  it('should stay disconnected when disabled', async () => {
    const { result } = renderHook(() =>
      useMediasoup({
        sfuUrl: 'http://localhost:3001',
        roomId: 'test-room',
        displayName: 'Alice',
        enabled: false,
      })
    )

    expect(result.current.connectionState).toBe('disconnected')
    expect(result.current.localStream).toBeNull()
    expect(result.current.remoteStreams.size).toBe(0)
    expect(result.current.reconnectingPeers.size).toBe(0)
  })

  it('should stay disconnected when sfuUrl is missing', async () => {
    const { result } = renderHook(() =>
      useMediasoup({
        sfuUrl: undefined,
        roomId: 'test-room',
        displayName: 'Alice',
        enabled: true,
      })
    )

    expect(result.current.connectionState).toBe('disconnected')
    expect(result.current.localStream).toBeNull()
    expect(result.current.remoteStreams.size).toBe(0)
    expect(result.current.reconnectingPeers.size).toBe(0)
  })

  it('should stay disconnected when roomId is missing', async () => {
    const { result } = renderHook(() =>
      useMediasoup({
        sfuUrl: 'http://localhost:3001',
        roomId: '',
        displayName: 'Alice',
        enabled: true,
      })
    )

    expect(result.current.connectionState).toBe('disconnected')
    expect(result.current.localStream).toBeNull()
    expect(result.current.remoteStreams.size).toBe(0)
    expect(result.current.reconnectingPeers.size).toBe(0)
  })

  it('should stay disconnected when displayName is missing', async () => {
    const { result } = renderHook(() =>
      useMediasoup({
        sfuUrl: 'http://localhost:3001',
        roomId: 'test-room',
        displayName: '',
        enabled: true,
      })
    )

    expect(result.current.connectionState).toBe('disconnected')
    expect(result.current.localStream).toBeNull()
    expect(result.current.remoteStreams.size).toBe(0)
    expect(result.current.reconnectingPeers.size).toBe(0)
  })

  it('should set connecting state on mount', async () => {
    const { result } = renderHook(() =>
      useMediasoup({
        sfuUrl: 'http://localhost:3001',
        roomId: 'test-room',
        displayName: 'Alice',
        enabled: true,
      })
    )

    await waitFor(() => {
      expect(result.current.connectionState).toBe('connecting')
    })
  })

  it('should set error state on connect_error when no previous connection', async () => {
    const { result } = renderHook(() =>
      useMediasoup({
        sfuUrl: 'http://localhost:3001',
        roomId: 'test-room',
        displayName: 'Alice',
        enabled: true,
      })
    )

    await waitFor(() => {
      expect(result.current.connectionState).toBe('connecting')
    })

    const connectErrorHandler = getSocketHandler('connect_error')
    expect(connectErrorHandler).toBeDefined()

    act(() => {
      connectErrorHandler!(new Error('Connection failed'))
    })

    await waitFor(() => {
      expect(result.current.connectionState).toBe('error')
    })
  })

  it('should toggle audio mute', async () => {
    const mockTrack = {
      readyState: 'live',
      enabled: true,
      stop: vi.fn(),
    }
    const mockStream = {
      getVideoTracks: () => [mockTrack],
      getAudioTracks: () => [mockTrack],
      getTracks: () => [mockTrack],
    }
    ;(global.navigator.mediaDevices.getUserMedia as any).mockResolvedValue(mockStream)

    const { result } = renderHook(() =>
      useMediasoup({
        sfuUrl: 'http://localhost:3001',
        roomId: 'test-room',
        displayName: 'Alice',
        enabled: true,
      })
    )

    await waitFor(() => {
      expect(result.current.connectionState).toBe('connecting')
    })

    // Trigger connect to set up localStream
    const connectHandler = getSocketHandler('connect')
    if (connectHandler) {
      await act(async () => {
        await connectHandler()
      })
    }

    await waitFor(() => {
      expect(result.current.localStream).not.toBeNull()
    })

    expect(result.current.audioMuted).toBe(false)

    act(() => {
      result.current.toggleMute()
    })

    await waitFor(() => {
      expect(result.current.audioMuted).toBe(true)
    })

    act(() => {
      result.current.toggleMute()
    })

    await waitFor(() => {
      expect(result.current.audioMuted).toBe(false)
    })
  })

  it('should toggle video off', async () => {
    const mockTrack = {
      readyState: 'live',
      enabled: true,
      stop: vi.fn(),
    }
    const mockStream = {
      getVideoTracks: () => [mockTrack],
      getAudioTracks: () => [mockTrack],
      getTracks: () => [mockTrack],
    }
    ;(global.navigator.mediaDevices.getUserMedia as any).mockResolvedValue(mockStream)

    const { result } = renderHook(() =>
      useMediasoup({
        sfuUrl: 'http://localhost:3001',
        roomId: 'test-room',
        displayName: 'Alice',
        enabled: true,
      })
    )

    await waitFor(() => {
      expect(result.current.connectionState).toBe('connecting')
    })

    // Trigger connect to set up localStream
    const connectHandler = getSocketHandler('connect')
    if (connectHandler) {
      await act(async () => {
        await connectHandler()
      })
    }

    await waitFor(() => {
      expect(result.current.localStream).not.toBeNull()
    })

    expect(result.current.videoOff).toBe(false)

    act(() => {
      result.current.toggleVideo()
    })

    await waitFor(() => {
      expect(result.current.videoOff).toBe(true)
    })

    act(() => {
      result.current.toggleVideo()
    })

    await waitFor(() => {
      expect(result.current.videoOff).toBe(false)
    })
  })

  it('should call cleanup on disconnect', async () => {
    const { result } = renderHook(() =>
      useMediasoup({
        sfuUrl: 'http://localhost:3001',
        roomId: 'test-room',
        displayName: 'Alice',
        enabled: true,
      })
    )

    await waitFor(() => {
      expect(result.current.connectionState).toBe('connecting')
    })

    act(() => {
      result.current.disconnect()
    })

    await waitFor(() => {
      expect(mockSocket.disconnect).toHaveBeenCalled()
      expect(result.current.connectionState).toBe('disconnected')
    })
  })

  it('should disconnect and cleanup on unmount', async () => {
    const { result, unmount } = renderHook(() =>
      useMediasoup({
        sfuUrl: 'http://localhost:3001',
        roomId: 'test-room',
        displayName: 'Alice',
        enabled: true,
      })
    )

    await waitFor(() => {
      expect(result.current.connectionState).toBe('connecting')
    })

    unmount()

    await waitFor(() => {
      expect(mockSocket.disconnect).toHaveBeenCalled()
    })
  })

  it('should return all expected values including reconnectingPeers', async () => {
    const { result } = renderHook(() =>
      useMediasoup({
        sfuUrl: 'http://localhost:3001',
        roomId: 'test-room',
        displayName: 'Alice',
        enabled: true,
      })
    )

    expect(result.current).toHaveProperty('connectionState')
    expect(result.current).toHaveProperty('localStream')
    expect(result.current).toHaveProperty('remoteStreams')
    expect(result.current).toHaveProperty('reconnectingPeers')
    expect(result.current).toHaveProperty('audioMuted')
    expect(result.current).toHaveProperty('videoOff')
    expect(result.current).toHaveProperty('toggleMute')
    expect(result.current).toHaveProperty('toggleVideo')
    expect(result.current).toHaveProperty('disconnect')

    expect(result.current.reconnectingPeers).toBeInstanceOf(Set)
    expect(result.current.reconnectingPeers.size).toBe(0)
  })

  // ────────────────────────────────────────────────────────────────────
  // New reconnection tests
  // ────────────────────────────────────────────────────────────────────

  it('should set reconnecting state on socket disconnect', async () => {
    const { result } = renderHook(() =>
      useMediasoup({
        sfuUrl: 'http://localhost:3001',
        roomId: 'test-room',
        displayName: 'Alice',
        enabled: true,
      })
    )

    await waitFor(() => {
      expect(result.current.connectionState).toBe('connecting')
    })

    // Trigger connect first to establish connection
    const connectHandler = getSocketHandler('connect')
    if (connectHandler) {
      await act(async () => {
        await connectHandler()
      })
    }

    await waitFor(() => {
      expect(result.current.connectionState).toBe('connected')
    })

    // Now trigger disconnect
    const disconnectHandler = getSocketHandler('disconnect')
    expect(disconnectHandler).toBeDefined()

    act(() => {
      disconnectHandler!()
    })

    await waitFor(() => {
      expect(result.current.connectionState).toBe('reconnecting')
    })
  })

  it('should add peer to reconnectingPeers on peerReconnecting event', async () => {
    const { result } = renderHook(() =>
      useMediasoup({
        sfuUrl: 'http://localhost:3001',
        roomId: 'test-room',
        displayName: 'Alice',
        enabled: true,
      })
    )

    await waitFor(() => {
      expect(result.current.connectionState).toBe('connecting')
    })

    const peerReconnectingHandler = getSocketHandler('peerReconnecting')
    expect(peerReconnectingHandler).toBeDefined()

    act(() => {
      peerReconnectingHandler!({ peerId: 'peer-1', displayName: 'Bob' })
    })

    await waitFor(() => {
      expect(result.current.reconnectingPeers.has('peer-1')).toBe(true)
      expect(result.current.reconnectingPeers.size).toBe(1)
    })
  })

  it('should remove peer from reconnectingPeers on peerReconnected event', async () => {
    const { result } = renderHook(() =>
      useMediasoup({
        sfuUrl: 'http://localhost:3001',
        roomId: 'test-room',
        displayName: 'Alice',
        enabled: true,
      })
    )

    await waitFor(() => {
      expect(result.current.connectionState).toBe('connecting')
    })

    const peerReconnectingHandler = getSocketHandler('peerReconnecting')
    const peerReconnectedHandler = getSocketHandler('peerReconnected')
    expect(peerReconnectingHandler).toBeDefined()
    expect(peerReconnectedHandler).toBeDefined()

    // Add peer to reconnecting set
    act(() => {
      peerReconnectingHandler!({ peerId: 'peer-1', displayName: 'Bob' })
    })

    await waitFor(() => {
      expect(result.current.reconnectingPeers.has('peer-1')).toBe(true)
    })

    // Remove peer from reconnecting set
    act(() => {
      peerReconnectedHandler!({ peerId: 'peer-1', displayName: 'Bob' })
    })

    await waitFor(() => {
      expect(result.current.reconnectingPeers.has('peer-1')).toBe(false)
      expect(result.current.reconnectingPeers.size).toBe(0)
    })
  })

  it('should remove peer from reconnectingPeers on peerLeft event', async () => {
    const { result } = renderHook(() =>
      useMediasoup({
        sfuUrl: 'http://localhost:3001',
        roomId: 'test-room',
        displayName: 'Alice',
        enabled: true,
      })
    )

    await waitFor(() => {
      expect(result.current.connectionState).toBe('connecting')
    })

    const peerReconnectingHandler = getSocketHandler('peerReconnecting')
    const peerLeftHandler = getSocketHandler('peerLeft')
    expect(peerReconnectingHandler).toBeDefined()
    expect(peerLeftHandler).toBeDefined()

    // Add peer to reconnecting set
    act(() => {
      peerReconnectingHandler!({ peerId: 'peer-1', displayName: 'Bob' })
    })

    await waitFor(() => {
      expect(result.current.reconnectingPeers.has('peer-1')).toBe(true)
    })

    // Peer leaves
    act(() => {
      peerLeftHandler!({ peerId: 'peer-1' })
    })

    await waitFor(() => {
      expect(result.current.reconnectingPeers.has('peer-1')).toBe(false)
      expect(result.current.reconnectingPeers.size).toBe(0)
    })
  })

  it('should handle transportFailure event without crashing', async () => {
    const { result } = renderHook(() =>
      useMediasoup({
        sfuUrl: 'http://localhost:3001',
        roomId: 'test-room',
        displayName: 'Alice',
        enabled: true,
      })
    )

    await waitFor(() => {
      expect(result.current.connectionState).toBe('connecting')
    })

    const transportFailureHandler = getSocketHandler('transportFailure')
    expect(transportFailureHandler).toBeDefined()

    // Should not throw
    expect(() => {
      act(() => {
        transportFailureHandler!({ direction: 'send', reason: 'Network error' })
      })
    }).not.toThrow()
  })

  it('should not set error state on connect_error during reconnection', async () => {
    const { result } = renderHook(() =>
      useMediasoup({
        sfuUrl: 'http://localhost:3001',
        roomId: 'test-room',
        displayName: 'Alice',
        enabled: true,
      })
    )

    await waitFor(() => {
      expect(result.current.connectionState).toBe('connecting')
    })

    // Trigger connect first to establish connection and get stablePeerId
    const connectHandler = getSocketHandler('connect')
    if (connectHandler) {
      await act(async () => {
        await connectHandler()
      })
    }

    await waitFor(() => {
      expect(result.current.connectionState).toBe('connected')
    })

    // Trigger disconnect to enter reconnecting state
    const disconnectHandler = getSocketHandler('disconnect')
    act(() => {
      disconnectHandler!()
    })

    await waitFor(() => {
      expect(result.current.connectionState).toBe('reconnecting')
    })

    // Now trigger connect_error - should NOT change to error state
    const connectErrorHandler = getSocketHandler('connect_error')
    act(() => {
      connectErrorHandler!(new Error('Connection failed'))
    })

    // Wait a bit and verify state is still reconnecting
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(result.current.connectionState).toBe('reconnecting')
    expect(result.current.connectionState).not.toBe('error')
  })

  it('should have Socket.IO reconnection config set correctly', async () => {
    const { io } = await import('socket.io-client')

    renderHook(() =>
      useMediasoup({
        sfuUrl: 'http://localhost:3001',
        roomId: 'test-room',
        displayName: 'Alice',
        enabled: true,
      })
    )

    await waitFor(() => {
      expect(io).toHaveBeenCalledWith(
        'http://localhost:3001',
        expect.objectContaining({
          transports: ['websocket'],
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
        })
      )
    })
  })

  it('should handle multiple peers reconnecting simultaneously', async () => {
    const { result } = renderHook(() =>
      useMediasoup({
        sfuUrl: 'http://localhost:3001',
        roomId: 'test-room',
        displayName: 'Alice',
        enabled: true,
      })
    )

    await waitFor(() => {
      expect(result.current.connectionState).toBe('connecting')
    })

    const peerReconnectingHandler = getSocketHandler('peerReconnecting')
    expect(peerReconnectingHandler).toBeDefined()

    // Multiple peers start reconnecting
    act(() => {
      peerReconnectingHandler!({ peerId: 'peer-1', displayName: 'Bob' })
      peerReconnectingHandler!({ peerId: 'peer-2', displayName: 'Charlie' })
      peerReconnectingHandler!({ peerId: 'peer-3', displayName: 'Diana' })
    })

    await waitFor(() => {
      expect(result.current.reconnectingPeers.size).toBe(3)
      expect(result.current.reconnectingPeers.has('peer-1')).toBe(true)
      expect(result.current.reconnectingPeers.has('peer-2')).toBe(true)
      expect(result.current.reconnectingPeers.has('peer-3')).toBe(true)
    })

    // One peer reconnects
    const peerReconnectedHandler = getSocketHandler('peerReconnected')
    act(() => {
      peerReconnectedHandler!({ peerId: 'peer-2', displayName: 'Charlie' })
    })

    await waitFor(() => {
      expect(result.current.reconnectingPeers.size).toBe(2)
      expect(result.current.reconnectingPeers.has('peer-1')).toBe(true)
      expect(result.current.reconnectingPeers.has('peer-2')).toBe(false)
      expect(result.current.reconnectingPeers.has('peer-3')).toBe(true)
    })
  })
})
