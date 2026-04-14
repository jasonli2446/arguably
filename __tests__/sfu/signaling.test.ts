import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Shared mocks ──

const mockRouter = {
  rtpCapabilities: { codecs: [{ mimeType: 'audio/opus' }] },
  canConsume: vi.fn().mockReturnValue(true),
  close: vi.fn(),
}

const mockRoom = {
  id: 'room-1',
  router: mockRouter,
  peers: new Map(),
}

const mockTransport = {
  id: 'transport-1',
  close: vi.fn(),
  connect: vi.fn(),
  on: vi.fn(),
}

const mockProducer = {
  id: 'producer-1',
  kind: 'audio',
  closed: false,
  close: vi.fn(),
  on: vi.fn(),
}

const mockConsumer = {
  id: 'consumer-1',
  kind: 'audio',
  rtpParameters: {},
  closed: false,
  resume: vi.fn(),
  on: vi.fn(),
}

const mockIceServers = [{ urls: 'stun:stun.l.google.com:19302' }]

// ── Module mocks ──

vi.mock('../../realtime/src/config.js', () => ({
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}))

vi.mock('../../realtime/src/mediasoup/rooms.js', () => ({
  getOrCreateRoom: vi.fn(),
  addPeerToRoom: vi.fn(),
  removePeerFromRoom: vi.fn(),
  getRoom: vi.fn(),
  deleteRoom: vi.fn(),
}))

vi.mock('../../realtime/src/mediasoup/transports.js', () => ({
  createWebRtcTransport: vi.fn(),
  getTransportOptions: vi.fn(),
}))

vi.mock('../../realtime/src/mediasoup/producers.js', () => ({
  createProducer: vi.fn(),
}))

vi.mock('../../realtime/src/mediasoup/consumers.js', () => ({
  createConsumer: vi.fn(),
}))

// ── Socket/IO mock helpers ──

function createMockSocket(id = 'socket-1') {
  const handlers = new Map<string, Function>()
  const emittedEvents: { event: string; data: any }[] = []

  return {
    id,
    handlers,
    emittedEvents,
    on(event: string, handler: Function) {
      handlers.set(event, handler)
    },
    join: vi.fn(),
    to: vi.fn().mockReturnThis(),
    emit: vi.fn((...args: any[]) => {
      emittedEvents.push({ event: args[0], data: args[1] })
    }),
    triggerHandler(event: string, data: any, callback?: Function) {
      const handler = handlers.get(event)
      if (!handler) throw new Error(`No handler for event: ${event}`)
      return handler(data, callback)
    },
  }
}

function createMockIO() {
  let connectionHandler: Function | null = null
  const ioEmittedEvents: { event: string; data: any; roomId: string }[] = []

  return {
    on(event: string, handler: Function) {
      if (event === 'connection') connectionHandler = handler
    },
    to: vi.fn((roomId: string) => ({
      emit: vi.fn((...args: any[]) => {
        ioEmittedEvents.push({ event: args[0], data: args[1], roomId })
      }),
    })),
    ioEmittedEvents,
    simulateConnection(socket: any) {
      if (connectionHandler) connectionHandler(socket)
    },
  }
}

// ── Tests ──

let setupSignaling: any
let getGracePeriodCount: any

beforeEach(async () => {
  vi.clearAllMocks()

  // Reset module to clear socketRoomMap/socketPeerMap/gracePeriodTimers
  vi.resetModules()

  // Re-apply mocks after resetModules
  vi.doMock('../../realtime/src/config.js', () => ({
    iceServers: mockIceServers,
  }))
  vi.doMock('../../realtime/src/mediasoup/rooms.js', () => ({
    getOrCreateRoom: vi.fn().mockResolvedValue(mockRoom),
    addPeerToRoom: vi.fn(),
    removePeerFromRoom: vi.fn(),
    getRoom: vi.fn().mockReturnValue(mockRoom),
    deleteRoom: vi.fn(),
  }))
  vi.doMock('../../realtime/src/mediasoup/transports.js', () => ({
    createWebRtcTransport: vi.fn().mockResolvedValue(mockTransport),
    getTransportOptions: vi.fn().mockReturnValue({
      id: 'transport-1',
      iceParameters: {},
      iceCandidates: [],
      dtlsParameters: {},
    }),
  }))
  vi.doMock('../../realtime/src/mediasoup/producers.js', () => ({
    createProducer: vi.fn().mockResolvedValue(mockProducer),
  }))
  vi.doMock('../../realtime/src/mediasoup/consumers.js', () => ({
    createConsumer: vi.fn().mockResolvedValue(mockConsumer),
  }))

  const mod = await import('../../realtime/src/signaling.js')
  setupSignaling = mod.setupSignaling
  getGracePeriodCount = mod.getGracePeriodCount

  // Reset shared mocks
  mockRoom.peers = new Map()
  mockTransport.close.mockClear()
  mockTransport.on.mockClear()
  mockProducer.close.mockClear()
  mockProducer.on.mockClear()
  mockProducer.closed = false
  mockConsumer.on.mockClear()
  mockConsumer.closed = false
})

afterEach(() => {
  vi.useRealTimers()
})

// Helper: set up a connected socket with signaling handlers
function setupSocket(id = 'socket-1', io?: ReturnType<typeof createMockIO>) {
  const mockIO = io || createMockIO()
  const socket = createMockSocket(id)
  setupSignaling(mockIO)
  mockIO.simulateConnection(socket)
  return { socket, io: mockIO }
}

// Helper: join a socket to a room
async function joinSocket(socket: ReturnType<typeof createMockSocket>, roomId = 'room-1', displayName = 'TestUser') {
  const callback = vi.fn()
  await socket.triggerHandler('joinRoom', {
    roomId,
    displayName,
    rtpCapabilities: { codecs: [] },
  }, callback)
  return callback
}

describe('setupSignaling', () => {
  describe('getRouterRtpCapabilities', () => {
    it('returns rtpCapabilities and iceServers on success', async () => {
      const { socket } = setupSocket()
      const callback = vi.fn()

      await socket.triggerHandler('getRouterRtpCapabilities', { roomId: 'room-1' }, callback)

      expect(callback).toHaveBeenCalledWith({
        success: true,
        rtpCapabilities: mockRouter.rtpCapabilities,
        iceServers: mockIceServers,
      })
    })

    it('returns error on failure', async () => {
      const { getOrCreateRoom } = await import('../../realtime/src/mediasoup/rooms.js')
      vi.mocked(getOrCreateRoom).mockRejectedValueOnce(new Error('Worker crashed'))

      const { socket } = setupSocket()
      const callback = vi.fn()

      await socket.triggerHandler('getRouterRtpCapabilities', { roomId: 'room-1' }, callback)

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'Error: Worker crashed',
      })
    })
  })

  describe('joinRoom', () => {
    it('creates peer with stablePeerId and state, returns it to client', async () => {
      const { socket } = setupSocket()
      const { addPeerToRoom } = await import('../../realtime/src/mediasoup/rooms.js')

      const callback = await joinSocket(socket, 'room-1', 'Alice')

      expect(addPeerToRoom).toHaveBeenCalled()
      const addedPeer = vi.mocked(addPeerToRoom).mock.calls[0][1]
      expect(addedPeer.stablePeerId).toBeDefined()
      expect(addedPeer.state).toBe('connected')
      expect(addedPeer.id).toBe('socket-1')

      expect(socket.join).toHaveBeenCalledWith('room-1')
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          stablePeerId: expect.any(String),
          peers: [],
        }),
      )
    })

    it('filters out peers in grace state from existing peers list', async () => {
      const connectedPeer = { id: 'p1', stablePeerId: 'u1', displayName: 'Bob', state: 'connected' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      const gracePeer = { id: 'p2', stablePeerId: 'u2', displayName: 'Eve', state: 'grace' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      mockRoom.peers.set('p1', connectedPeer)
      mockRoom.peers.set('p2', gracePeer)

      const { socket } = setupSocket()
      const callback = await joinSocket(socket, 'room-1', 'Alice')

      const response = callback.mock.calls[0][0]
      expect(response.peers).toEqual([{ peerId: 'p1', displayName: 'Bob' }])
    })
  })

  describe('createWebRtcTransport', () => {
    it('stores transport with direction tag', async () => {
      const { socket } = setupSocket()
      await joinSocket(socket)

      const peer = { id: 'socket-1', stablePeerId: 'u', displayName: 'TestUser', state: 'connected' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      mockRoom.peers.set('socket-1', peer)

      const callback = vi.fn()
      await socket.triggerHandler('createWebRtcTransport', { direction: 'send' }, callback)

      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
      const stored = peer.transports.get('transport-1')
      expect(stored).toEqual({ transport: mockTransport, direction: 'send' })
    })

    it('registers DTLS state change handler', async () => {
      const { socket } = setupSocket()
      await joinSocket(socket)

      const peer = { id: 'socket-1', stablePeerId: 'u', displayName: 'TestUser', state: 'connected' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      mockRoom.peers.set('socket-1', peer)

      await socket.triggerHandler('createWebRtcTransport', { direction: 'send' }, vi.fn())

      expect(mockTransport.on).toHaveBeenCalledWith('dtlsstatechange', expect.any(Function))
    })

    it('returns error when not in a room', async () => {
      const io = createMockIO()
      const socket = createMockSocket('orphan')
      setupSignaling(io)
      io.simulateConnection(socket)

      const callback = vi.fn()
      await socket.triggerHandler('createWebRtcTransport', { direction: 'send' }, callback)

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: expect.stringContaining('Not in a room'),
      })
    })
  })

  describe('connectTransport', () => {
    it('unwraps TransportInfo and connects', async () => {
      const { socket } = setupSocket()
      await joinSocket(socket)

      const transport = { ...mockTransport, connect: vi.fn().mockResolvedValue(undefined) }
      const peer = { id: 'socket-1', stablePeerId: 'u', displayName: 'TestUser', state: 'connected' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      peer.transports.set('transport-1', { transport, direction: 'send' })
      mockRoom.peers.set('socket-1', peer)

      const callback = vi.fn()
      await socket.triggerHandler('connectTransport', {
        transportId: 'transport-1',
        dtlsParameters: { fingerprints: [] },
      }, callback)

      expect(transport.connect).toHaveBeenCalledWith({ dtlsParameters: { fingerprints: [] } })
      expect(callback).toHaveBeenCalledWith({ success: true })
    })
  })

  describe('produce', () => {
    it('unwraps TransportInfo, creates producer with score listener, notifies room', async () => {
      const { socket } = setupSocket()
      await joinSocket(socket)

      const peer = { id: 'socket-1', stablePeerId: 'u', displayName: 'Alice', state: 'connected' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      peer.transports.set('transport-1', { transport: mockTransport, direction: 'send' })
      mockRoom.peers.set('socket-1', peer)

      const { createProducer } = await import('../../realtime/src/mediasoup/producers.js')
      const producer = { id: 'prod-1', kind: 'audio', closed: false, close: vi.fn(), on: vi.fn() }
      vi.mocked(createProducer).mockResolvedValueOnce(producer as any)

      const callback = vi.fn()
      await socket.triggerHandler('produce', {
        transportId: 'transport-1',
        kind: 'audio',
        rtpParameters: {},
      }, callback)

      expect(callback).toHaveBeenCalledWith({ success: true, producerId: 'prod-1' })
      expect(peer.producers.has('prod-1')).toBe(true)
      // Score listener attached
      expect(producer.on).toHaveBeenCalledWith('score', expect.any(Function))
      // transportclose listener attached
      expect(producer.on).toHaveBeenCalledWith('transportclose', expect.any(Function))
      // Notifies room
      expect(socket.to).toHaveBeenCalledWith('room-1')
    })
  })

  describe('consume', () => {
    it('uses direction-based recv transport lookup', async () => {
      const { socket } = setupSocket()
      await joinSocket(socket)

      // Consuming peer with recv transport
      const recvTransport = { id: 'recv-t', close: vi.fn() }
      const peer = { id: 'socket-1', stablePeerId: 'u', displayName: 'Bob', state: 'connected' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      peer.transports.set('send-t', { transport: { id: 'send-t', close: vi.fn() }, direction: 'send' })
      peer.transports.set('recv-t', { transport: recvTransport, direction: 'recv' })
      mockRoom.peers.set('socket-1', peer)

      // Producing peer
      const producerPeer = { id: 'p2', stablePeerId: 'u2', displayName: 'Alice', state: 'connected' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      producerPeer.producers.set('prod-1', { id: 'prod-1', kind: 'audio', closed: false })
      mockRoom.peers.set('p2', producerPeer)

      const { createConsumer } = await import('../../realtime/src/mediasoup/consumers.js')
      const consumer = { id: 'cons-1', kind: 'audio', rtpParameters: {}, closed: false, on: vi.fn() }
      vi.mocked(createConsumer).mockResolvedValueOnce(consumer as any)

      const callback = vi.fn()
      await socket.triggerHandler('consume', { producerId: 'prod-1' }, callback)

      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        id: 'cons-1',
        peerId: 'p2',
        displayName: 'Alice',
      }))
      // Score listener on consumer
      expect(consumer.on).toHaveBeenCalledWith('score', expect.any(Function))
    })

    it('throws error when producer not found in any peer', async () => {
      const { socket } = setupSocket()
      await joinSocket(socket)

      const peer = { id: 'socket-1', stablePeerId: 'u', displayName: 'Bob', state: 'connected' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      peer.transports.set('recv-t', { transport: { id: 'recv-t', close: vi.fn() }, direction: 'recv' })
      mockRoom.peers.set('socket-1', peer)

      const callback = vi.fn()
      await socket.triggerHandler('consume', { producerId: 'nonexistent' }, callback)

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: expect.stringContaining('Producer nonexistent not found in any peer'),
      })
    })

    it('throws error when no recv transport exists', async () => {
      const { socket } = setupSocket()
      await joinSocket(socket)

      const peer = { id: 'socket-1', stablePeerId: 'u', displayName: 'Bob', state: 'connected' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      peer.transports.set('send-t', { transport: { id: 'send-t', close: vi.fn() }, direction: 'send' })
      mockRoom.peers.set('socket-1', peer)

      const callback = vi.fn()
      await socket.triggerHandler('consume', { producerId: 'prod-1' }, callback)

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: expect.stringContaining('Recv transport not found'),
      })
    })
  })

  describe('getProducers', () => {
    it('returns producers from connected peers, excludes closed and grace peers', async () => {
      const { socket } = setupSocket()
      await joinSocket(socket)

      const selfPeer = { id: 'socket-1', stablePeerId: 'u0', displayName: 'Me', state: 'connected' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      mockRoom.peers.set('socket-1', selfPeer)

      const connectedPeer = { id: 'p2', stablePeerId: 'u1', displayName: 'Alice', state: 'connected' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      connectedPeer.producers.set('prod-1', { id: 'prod-1', kind: 'audio', closed: false })
      connectedPeer.producers.set('prod-2', { id: 'prod-2', kind: 'video', closed: true }) // closed
      mockRoom.peers.set('p2', connectedPeer)

      const gracePeer = { id: 'p3', stablePeerId: 'u2', displayName: 'Eve', state: 'grace' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      gracePeer.producers.set('prod-3', { id: 'prod-3', kind: 'audio', closed: false })
      mockRoom.peers.set('p3', gracePeer)

      const callback = vi.fn()
      await socket.triggerHandler('getProducers', {}, callback)

      expect(callback).toHaveBeenCalledWith({
        success: true,
        producers: [
          { producerId: 'prod-1', peerId: 'p2', displayName: 'Alice', kind: 'audio' },
        ],
      })
    })
  })

  describe('disconnect — grace period', () => {
    it('sets peer state to grace and emits peerReconnecting', async () => {
      const io = createMockIO()
      const socket = createMockSocket()
      setupSignaling(io)
      io.simulateConnection(socket)
      await joinSocket(socket, 'room-1', 'Alice')

      // Manually set up the peer in mockRoom (since addPeerToRoom is mocked)
      const peer = { id: 'socket-1', stablePeerId: 'u', displayName: 'Alice', state: 'connected' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      mockRoom.peers.set('socket-1', peer)

      socket.triggerHandler('disconnect', undefined)

      expect(peer.state).toBe('grace')
      const reconnecting = io.ioEmittedEvents.find((e) => e.event === 'peerReconnecting')
      expect(reconnecting).toBeDefined()
      expect(reconnecting?.data.displayName).toBe('Alice')
    })

    it('closes transports and clears maps on disconnect', async () => {
      const io = createMockIO()
      const socket = createMockSocket()
      setupSignaling(io)
      io.simulateConnection(socket)
      await joinSocket(socket, 'room-1', 'Alice')

      const transport = { id: 't1', close: vi.fn(), on: vi.fn() }
      const peer = { id: 'socket-1', stablePeerId: 'u', displayName: 'Alice', state: 'connected' as const, transports: new Map([['t1', { transport, direction: 'send' as const }]]), producers: new Map([['p1', { id: 'p1' }]]), consumers: new Map([['c1', { id: 'c1' }]]) }
      mockRoom.peers.set('socket-1', peer)

      socket.triggerHandler('disconnect', undefined)

      expect(transport.close).toHaveBeenCalled()
      expect(peer.transports.size).toBe(0)
      expect(peer.producers.size).toBe(0)
      expect(peer.consumers.size).toBe(0)
    })

    it('starts grace period timer', async () => {
      const { socket } = setupSocket()
      await joinSocket(socket, 'room-1', 'Alice')

      const peer = { id: 'socket-1', stablePeerId: 'u', displayName: 'Alice', state: 'connected' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      mockRoom.peers.set('socket-1', peer)

      expect(getGracePeriodCount()).toBe(0)
      socket.triggerHandler('disconnect', undefined)
      expect(getGracePeriodCount()).toBe(1)
    })

    it('does not crash when orphan socket disconnects', () => {
      const io = createMockIO()
      const socket = createMockSocket('orphan')
      setupSignaling(io)
      io.simulateConnection(socket)

      // Should not throw
      socket.triggerHandler('disconnect', undefined)
      expect(getGracePeriodCount()).toBe(0)
    })
  })

  describe('disconnect — grace period expiry', () => {
    beforeEach(() => { vi.useFakeTimers() })

    it('removes peer and emits peerLeft after 30s', async () => {
      const io = createMockIO()
      const socket = createMockSocket()
      setupSignaling(io)
      io.simulateConnection(socket)
      await joinSocket(socket, 'room-1', 'Alice')

      const peer = { id: 'socket-1', stablePeerId: 'u', displayName: 'Alice', state: 'connected' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      mockRoom.peers.set('socket-1', peer)

      socket.triggerHandler('disconnect', undefined)
      expect(mockRoom.peers.has('socket-1')).toBe(true)

      vi.advanceTimersByTime(30_000)

      expect(mockRoom.peers.has('socket-1')).toBe(false)
      expect(getGracePeriodCount()).toBe(0)

      const peerLeft = io.ioEmittedEvents.find((e) => e.event === 'peerLeft')
      expect(peerLeft).toBeDefined()
      expect(peerLeft?.data.displayName).toBe('Alice')
    })

    it('calls deleteRoom when last peer grace expires', async () => {
      const io = createMockIO()
      const socket = createMockSocket()
      setupSignaling(io)
      io.simulateConnection(socket)
      await joinSocket(socket, 'room-1', 'Alice')

      const peer = { id: 'socket-1', stablePeerId: 'u', displayName: 'Alice', state: 'connected' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      mockRoom.peers.set('socket-1', peer)

      socket.triggerHandler('disconnect', undefined)
      vi.advanceTimersByTime(30_000)

      const { deleteRoom } = await import('../../realtime/src/mediasoup/rooms.js')
      expect(deleteRoom).toHaveBeenCalledWith('room-1')
    })
  })

  describe('reconnect within grace period', () => {
    beforeEach(() => { vi.useFakeTimers() })

    it('cancels timer, re-keys peer, broadcasts peerReconnected', async () => {
      const io = createMockIO()
      const oldSocket = createMockSocket('old-socket')
      setupSignaling(io)
      io.simulateConnection(oldSocket)

      const joinCb = await joinSocket(oldSocket, 'room-1', 'Alice')
      const stablePeerId = joinCb.mock.calls[0][0].stablePeerId

      const peer = { id: 'old-socket', stablePeerId, displayName: 'Alice', state: 'connected' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      mockRoom.peers.set('old-socket', peer)

      oldSocket.triggerHandler('disconnect', undefined)
      expect(getGracePeriodCount()).toBe(1)

      // New socket reconnects
      const newSocket = createMockSocket('new-socket')
      io.simulateConnection(newSocket)

      const callback = vi.fn()
      await newSocket.triggerHandler('reconnect', {
        roomId: 'room-1',
        stablePeerId,
        displayName: 'Alice',
        rtpCapabilities: { codecs: [] },
      }, callback)

      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
      expect(getGracePeriodCount()).toBe(0)

      // Peer re-keyed
      expect(mockRoom.peers.has('old-socket')).toBe(false)
      expect(mockRoom.peers.has('new-socket')).toBe(true)
      const rekeyed = mockRoom.peers.get('new-socket')
      expect(rekeyed.id).toBe('new-socket')
      expect(rekeyed.state).toBe('connected')
      expect(rekeyed.stablePeerId).toBe(stablePeerId)

      // Socket joined room
      expect(newSocket.join).toHaveBeenCalledWith('room-1')

      // peerReconnected broadcast (via socket.to, not io.to)
      expect(newSocket.to).toHaveBeenCalledWith('room-1')
      const reconnectedEmit = newSocket.emittedEvents.find((e) => e.event === 'peerReconnected')
      expect(reconnectedEmit).toBeDefined()

      // Timer doesn't fire after reconnect
      vi.advanceTimersByTime(30_000)
      expect(mockRoom.peers.has('new-socket')).toBe(true)
    })
  })

  describe('reconnect — error cases', () => {
    it('returns error when no active grace period', async () => {
      const { socket } = setupSocket()

      const callback = vi.fn()
      await socket.triggerHandler('reconnect', {
        roomId: 'room-1',
        stablePeerId: 'nonexistent-uuid',
        displayName: 'Alice',
        rtpCapabilities: { codecs: [] },
      }, callback)

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'No active grace period. Please rejoin.',
      })
    })

    it('returns error when roomId mismatches', async () => {
      const io = createMockIO()
      const socket = createMockSocket()
      setupSignaling(io)
      io.simulateConnection(socket)

      const joinCb = await joinSocket(socket, 'room-1', 'Alice')
      const stablePeerId = joinCb.mock.calls[0][0].stablePeerId

      const peer = { id: 'socket-1', stablePeerId, displayName: 'Alice', state: 'connected' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      mockRoom.peers.set('socket-1', peer)

      socket.triggerHandler('disconnect', undefined)

      const newSocket = createMockSocket('new')
      io.simulateConnection(newSocket)

      const callback = vi.fn()
      await newSocket.triggerHandler('reconnect', {
        roomId: 'wrong-room',
        stablePeerId,
        displayName: 'Alice',
        rtpCapabilities: { codecs: [] },
      }, callback)

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'Room mismatch.',
      })
    })
  })

  describe('DTLS failure handling', () => {
    it('cleans up transport, notifies client on DTLS failed', async () => {
      const { socket } = setupSocket()
      await joinSocket(socket, 'room-1', 'Alice')

      const peer = { id: 'socket-1', stablePeerId: 'u', displayName: 'Alice', state: 'connected' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      mockRoom.peers.set('socket-1', peer)

      // Create transport to register the handler
      await socket.triggerHandler('createWebRtcTransport', { direction: 'send' }, vi.fn())

      // Find the DTLS handler
      const dtlsCall = mockTransport.on.mock.calls.find((c: any) => c[0] === 'dtlsstatechange')
      expect(dtlsCall).toBeDefined()
      const dtlsHandler = dtlsCall![1]

      // Simulate DTLS failure
      dtlsHandler('failed')

      expect(mockTransport.close).toHaveBeenCalled()
      expect(peer.transports.has('transport-1')).toBe(false)

      // transportFailure emitted to client
      const failure = socket.emittedEvents.find((e) => e.event === 'transportFailure')
      expect(failure).toBeDefined()
      expect(failure?.data.direction).toBe('send')
      expect(failure?.data.reason).toContain('failed')
    })
  })

  describe('getGracePeriodCount', () => {
    it('tracks active grace timers correctly', async () => {
      vi.useFakeTimers()

      expect(getGracePeriodCount()).toBe(0)

      const io = createMockIO()
      const s1 = createMockSocket('s1')
      const s2 = createMockSocket('s2')
      setupSignaling(io)
      io.simulateConnection(s1)
      io.simulateConnection(s2)

      await joinSocket(s1, 'room-1', 'Alice')
      const peer1 = { id: 's1', stablePeerId: 'u1', displayName: 'Alice', state: 'connected' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      mockRoom.peers.set('s1', peer1)

      await joinSocket(s2, 'room-1', 'Bob')
      const peer2 = { id: 's2', stablePeerId: 'u2', displayName: 'Bob', state: 'connected' as const, transports: new Map(), producers: new Map(), consumers: new Map() }
      mockRoom.peers.set('s2', peer2)

      s1.triggerHandler('disconnect', undefined)
      expect(getGracePeriodCount()).toBe(1)

      s2.triggerHandler('disconnect', undefined)
      expect(getGracePeriodCount()).toBe(2)

      vi.advanceTimersByTime(30_000)
      expect(getGracePeriodCount()).toBe(0)
    })
  })
})
