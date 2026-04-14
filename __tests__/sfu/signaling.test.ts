import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  close: vi.fn(),
  on: vi.fn(),
  closed: false,
}

const mockConsumer = {
  id: 'consumer-1',
  kind: 'audio',
  rtpParameters: {},
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
  getRoomCount: vi.fn().mockReturnValue(0),
  getAllRoomStats: vi.fn().mockReturnValue([]),
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

// Mock validation
vi.mock('../../realtime/src/validation.js', () => ({
  schemas: {
    getRouterRtpCapabilities: {},
    joinRoom: {},
    reconnect: {},
    createWebRtcTransport: {},
    connectTransport: {},
    produce: {},
    consume: {},
    resumeConsumer: {},
    closeProducer: {},
    getProducers: {},
  },
  validatePayload: vi.fn((schema: any, data: any) => {
    return { success: true, data }
  }),
}))

// Import mocked modules
import { getOrCreateRoom, addPeerToRoom, removePeerFromRoom, getRoom } from '../../realtime/src/mediasoup/rooms.js'
import { createWebRtcTransport, getTransportOptions } from '../../realtime/src/mediasoup/transports.js'
import { createProducer } from '../../realtime/src/mediasoup/producers.js'
import { createConsumer } from '../../realtime/src/mediasoup/consumers.js'

// ── Socket/IO mock helpers ──

function createMockSocket(id = 'socket-1') {
  const handlers = new Map<string, Function>()
  const emittedEvents: { event: string; data: any }[] = []
  const emittedToRoom = new Map<string, Array<{ event: string; data: any }>>()

  return {
    id,
    handlers,
    emittedEvents,
    emittedToRoom,
    handshake: { auth: {} },
    on(event: string, handler: Function) {
      handlers.set(event, handler)
    },
    join: vi.fn(),
    to: vi.fn((roomId: string) => {
      return {
        emit: vi.fn((event: string, data: any) => {
          if (!emittedToRoom.has(roomId)) {
            emittedToRoom.set(roomId, [])
          }
          emittedToRoom.get(roomId)!.push({ event, data })
        }),
      }
    }),
    emit: vi.fn((...args: any[]) => {
      emittedEvents.push({ event: args[0], data: args[1] })
    }),
    // Helper to trigger a registered event handler
    triggerHandler(event: string, data: any, callback?: Function) {
      const handler = handlers.get(event)
      if (!handler) throw new Error(`No handler for event: ${event}`)
      return handler(data, callback)
    },
  }
}

function createMockIO() {
  let connectionHandler: Function | null = null
  const ioEmittedToRoom = new Map<string, Array<{ event: string; data: any }>>()

  return {
    on(event: string, handler: Function) {
      if (event === 'connection') connectionHandler = handler
    },
    to: vi.fn((roomId: string) => {
      return {
        emit: vi.fn((event: string, data: any) => {
          if (!ioEmittedToRoom.has(roomId)) {
            ioEmittedToRoom.set(roomId, [])
          }
          ioEmittedToRoom.get(roomId)!.push({ event, data })
        }),
      }
    }),
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
  vi.useFakeTimers()

  // Reset module to clear socketRoomMap/socketPeerMap
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
    getRoomCount: vi.fn().mockReturnValue(0),
    getAllRoomStats: vi.fn().mockReturnValue([]),
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
  vi.doMock('../../realtime/src/validation.js', () => ({
    schemas: {
      getRouterRtpCapabilities: {},
      joinRoom: {},
      reconnect: {},
      createWebRtcTransport: {},
      connectTransport: {},
      produce: {},
      consume: {},
      resumeConsumer: {},
      closeProducer: {},
      getProducers: {},
    },
    validatePayload: vi.fn((schema: any, data: any) => {
      return { success: true, data }
    }),
  }))

  const mod = await import('../../realtime/src/signaling.js')
  setupSignaling = mod.setupSignaling
  getGracePeriodCount = mod.getGracePeriodCount

  // Reset room peers for each test
  mockRoom.peers = new Map()
})

// Helper to set up a connected socket with signaling handlers
function setupSocket(id = 'socket-1') {
  const io = createMockIO()
  const socket = createMockSocket(id)
  setupSignaling(io)
  io.simulateConnection(socket)
  return socket
}

// Helper to join a socket to a room (prerequisite for most events)
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
      const socket = setupSocket()
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

      const socket = setupSocket()
      const callback = vi.fn()

      await socket.triggerHandler('getRouterRtpCapabilities', { roomId: 'room-1' }, callback)

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'Error: Worker crashed',
      })
    })
  })

  describe('joinRoom', () => {
    it('creates peer with stablePeerId, state, and returns existing connected peers', async () => {
      const socket = setupSocket()
      const { addPeerToRoom } = await import('../../realtime/src/mediasoup/rooms.js')

      // Add an existing connected peer
      const existingPeer = {
        id: 'other-socket',
        stablePeerId: 'stable-1',
        displayName: 'OtherUser',
        state: 'connected' as const,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map()
      }
      mockRoom.peers.set('other-socket', existingPeer)

      // Add a grace-state peer (should be filtered)
      const gracePeer = {
        id: 'grace-socket',
        stablePeerId: 'stable-2',
        displayName: 'GraceUser',
        state: 'grace' as const,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map()
      }
      mockRoom.peers.set('grace-socket', gracePeer)

      const callback = vi.fn()
      await socket.triggerHandler('joinRoom', {
        roomId: 'room-1',
        displayName: 'Alice',
        rtpCapabilities: { codecs: [] },
      }, callback)

      expect(addPeerToRoom).toHaveBeenCalled()
      expect(callback).toHaveBeenCalledWith({
        success: true,
        peers: [{ peerId: 'other-socket', displayName: 'OtherUser' }],
        stablePeerId: expect.any(String),
      })
    })
  })

  describe('createWebRtcTransport', () => {
    it('stores direction in TransportInfo', async () => {
      const socket = setupSocket()
      await joinSocket(socket)

      const peer = {
        id: 'socket-1',
        stablePeerId: 'stable-1',
        displayName: 'TestUser',
        state: 'connected' as const,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map()
      }
      mockRoom.peers.set('socket-1', peer)

      const callback = vi.fn()
      await socket.triggerHandler('createWebRtcTransport', { direction: 'send' }, callback)

      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        transportOptions: expect.objectContaining({ id: 'transport-1' }),
      }))

      // Check TransportInfo structure
      const transportInfo = peer.transports.get('transport-1')
      expect(transportInfo).toBeDefined()
      expect(transportInfo?.direction).toBe('send')
      expect(transportInfo?.transport).toBeDefined()
    })

    it('adds dtls failure handler that emits transportFailure', async () => {
      const socket = setupSocket()
      await joinSocket(socket)

      const peer = {
        id: 'socket-1',
        stablePeerId: 'stable-1',
        displayName: 'TestUser',
        state: 'connected' as const,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map()
      }
      mockRoom.peers.set('socket-1', peer)

      const mockTransportWithHandler = {
        ...mockTransport,
        on: vi.fn((event: string, handler: Function) => {
          if (event === 'dtlsstatechange') {
            // Simulate DTLS failure
            handler('failed')
          }
        }),
      }

      const { createWebRtcTransport } = await import('../../realtime/src/mediasoup/transports.js')
      vi.mocked(createWebRtcTransport).mockResolvedValueOnce(mockTransportWithHandler as any)

      const callback = vi.fn()
      await socket.triggerHandler('createWebRtcTransport', { direction: 'recv' }, callback)

      // Check that transportFailure was emitted
      expect(socket.emittedEvents.some(e => e.event === 'transportFailure')).toBe(true)
    })
  })

  describe('connectTransport', () => {
    it('unwraps TransportInfo to connect', async () => {
      const socket = setupSocket()
      await joinSocket(socket)

      const peer = {
        id: 'socket-1',
        stablePeerId: 'stable-1',
        displayName: 'TestUser',
        state: 'connected' as const,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map()
      }
      const transport = { ...mockTransport, connect: vi.fn().mockResolvedValue(undefined) }
      peer.transports.set('transport-1', { transport, direction: 'send' })
      mockRoom.peers.set('socket-1', peer)

      const dtlsParameters = { fingerprints: [] }
      const callback = vi.fn()
      await socket.triggerHandler('connectTransport', {
        transportId: 'transport-1',
        dtlsParameters,
      }, callback)

      expect(transport.connect).toHaveBeenCalledWith({ dtlsParameters })
      expect(callback).toHaveBeenCalledWith({ success: true })
    })
  })

  describe('produce', () => {
    it('unwraps TransportInfo and adds score listener', async () => {
      const socket = setupSocket()
      await joinSocket(socket)

      const peer = {
        id: 'socket-1',
        stablePeerId: 'stable-1',
        displayName: 'Alice',
        state: 'connected' as const,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map()
      }
      const transport = { ...mockTransport }
      peer.transports.set('transport-1', { transport, direction: 'send' })
      mockRoom.peers.set('socket-1', peer)

      const { createProducer } = await import('../../realtime/src/mediasoup/producers.js')
      const producer = { id: 'prod-1', kind: 'audio', close: vi.fn(), on: vi.fn(), closed: false }
      vi.mocked(createProducer).mockResolvedValueOnce(producer as any)

      const callback = vi.fn()
      await socket.triggerHandler('produce', {
        transportId: 'transport-1',
        kind: 'audio',
        rtpParameters: {},
        appData: {},
      }, callback)

      expect(callback).toHaveBeenCalledWith({ success: true, producerId: 'prod-1' })
      expect(peer.producers.has('prod-1')).toBe(true)

      // Check score listener was added
      expect(producer.on).toHaveBeenCalledWith('score', expect.any(Function))
    })
  })

  describe('consume', () => {
    it('uses direction-based recv transport lookup', async () => {
      const socket = setupSocket()
      await joinSocket(socket)

      const consumerPeer = {
        id: 'socket-1',
        stablePeerId: 'stable-1',
        displayName: 'Bob',
        state: 'connected' as const,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map()
      }
      const sendTransport = { id: 'send-transport', close: vi.fn() }
      const recvTransport = { id: 'recv-transport', close: vi.fn() }
      consumerPeer.transports.set('send-transport', { transport: sendTransport, direction: 'send' })
      consumerPeer.transports.set('recv-transport', { transport: recvTransport, direction: 'recv' })
      mockRoom.peers.set('socket-1', consumerPeer)

      const producerPeer = {
        id: 'socket-2',
        stablePeerId: 'stable-2',
        displayName: 'Alice',
        state: 'connected' as const,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map()
      }
      const producer = { id: 'prod-1', kind: 'audio' }
      producerPeer.producers.set('prod-1', producer)
      mockRoom.peers.set('socket-2', producerPeer)

      const { createConsumer } = await import('../../realtime/src/mediasoup/consumers.js')
      const consumer = { id: 'cons-1', kind: 'audio', rtpParameters: { codecs: [] }, on: vi.fn() }
      vi.mocked(createConsumer).mockResolvedValueOnce(consumer as any)

      const callback = vi.fn()
      await socket.triggerHandler('consume', { producerId: 'prod-1' }, callback)

      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        id: 'cons-1',
        producerId: 'prod-1',
        displayName: 'Alice',
      }))

      // Verify score listener was added
      expect(consumer.on).toHaveBeenCalledWith('score', expect.any(Function))
    })

    it('returns error if producer not found', async () => {
      const socket = setupSocket()
      await joinSocket(socket)

      const peer = {
        id: 'socket-1',
        stablePeerId: 'stable-1',
        displayName: 'Bob',
        state: 'connected' as const,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map()
      }
      const recvTransport = { id: 'recv-transport', close: vi.fn() }
      peer.transports.set('recv-transport', { transport: recvTransport, direction: 'recv' })
      mockRoom.peers.set('socket-1', peer)

      const callback = vi.fn()
      await socket.triggerHandler('consume', { producerId: 'nonexistent' }, callback)

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: expect.stringContaining('Producer nonexistent not found'),
      })
    })
  })

  describe('getProducers', () => {
    it('filters by state and closed status', async () => {
      const socket = setupSocket()
      await joinSocket(socket)

      const selfPeer = {
        id: 'socket-1',
        stablePeerId: 'stable-1',
        displayName: 'Bob',
        state: 'connected' as const,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map()
      }
      mockRoom.peers.set('socket-1', selfPeer)

      const otherPeer = {
        id: 'socket-2',
        stablePeerId: 'stable-2',
        displayName: 'Alice',
        state: 'connected' as const,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map()
      }
      otherPeer.producers.set('prod-1', { id: 'prod-1', kind: 'audio', closed: false })
      otherPeer.producers.set('prod-2', { id: 'prod-2', kind: 'video', closed: true })
      mockRoom.peers.set('socket-2', otherPeer)

      const gracePeer = {
        id: 'socket-3',
        stablePeerId: 'stable-3',
        displayName: 'Charlie',
        state: 'grace' as const,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map()
      }
      gracePeer.producers.set('prod-3', { id: 'prod-3', kind: 'audio', closed: false })
      mockRoom.peers.set('socket-3', gracePeer)

      const callback = vi.fn()
      await socket.triggerHandler('getProducers', {}, callback)

      expect(callback).toHaveBeenCalledWith({
        success: true,
        producers: [
          { producerId: 'prod-1', peerId: 'socket-2', displayName: 'Alice', kind: 'audio' },
        ],
      })
    })
  })

  describe('disconnect', () => {
    it('starts grace period and emits peerReconnecting', async () => {
      const io = createMockIO()
      const socket = createMockSocket('socket-1')
      setupSignaling(io)
      io.simulateConnection(socket)

      const callback = vi.fn()
      await socket.triggerHandler('joinRoom', {
        roomId: 'room-1',
        displayName: 'Alice',
        rtpCapabilities: { codecs: [] },
      }, callback)

      const peer = {
        id: 'socket-1',
        stablePeerId: callback.mock.calls[0][0].stablePeerId,
        displayName: 'Alice',
        state: 'connected' as const,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map()
      }
      mockRoom.peers.set('socket-1', peer)

      await socket.triggerHandler('disconnect', undefined)

      expect(peer.state).toBe('grace')
      expect(getGracePeriodCount()).toBe(1)

      // Check peerReconnecting was emitted
      const roomEmits = socket.emittedToRoom.get('room-1') || []
      const reconnectingEvent = roomEmits.find(e => e.event === 'peerReconnecting')
      expect(reconnectingEvent).toBeDefined()
      expect(reconnectingEvent?.data.displayName).toBe('Alice')
    })

    it('emits peerLeft after grace period expires', async () => {
      const io = createMockIO()
      const socket = createMockSocket('socket-1')
      setupSignaling(io)
      io.simulateConnection(socket)

      const callback = vi.fn()
      await socket.triggerHandler('joinRoom', {
        roomId: 'room-1',
        displayName: 'Alice',
        rtpCapabilities: { codecs: [] },
      }, callback)

      const peer = {
        id: 'socket-1',
        stablePeerId: callback.mock.calls[0][0].stablePeerId,
        displayName: 'Alice',
        state: 'connected' as const,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map()
      }
      mockRoom.peers.set('socket-1', peer)

      const { removePeerFromRoom } = await import('../../realtime/src/mediasoup/rooms.js')
      vi.mocked(removePeerFromRoom).mockReturnValueOnce(peer as any)

      await socket.triggerHandler('disconnect', undefined)

      // Fast-forward 30 seconds
      vi.advanceTimersByTime(30_000)

      expect(removePeerFromRoom).toHaveBeenCalled()
      expect(getGracePeriodCount()).toBe(0)
    })
  })

  describe('reconnect', () => {
    it('cancels grace period and updates peer socket ID', async () => {
      const io = createMockIO()
      const socket1 = createMockSocket('socket-1')
      setupSignaling(io)
      io.simulateConnection(socket1)

      const callback = vi.fn()
      await socket1.triggerHandler('joinRoom', {
        roomId: 'room-1',
        displayName: 'Alice',
        rtpCapabilities: { codecs: [] },
      }, callback)

      const stablePeerId = callback.mock.calls[0][0].stablePeerId

      const peer = {
        id: 'socket-1',
        stablePeerId,
        displayName: 'Alice',
        state: 'connected' as const,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map()
      }
      mockRoom.peers.set('socket-1', peer)

      await socket1.triggerHandler('disconnect', undefined)
      expect(getGracePeriodCount()).toBe(1)

      // New socket reconnects
      const socket2 = createMockSocket('socket-2')
      io.simulateConnection(socket2)

      const reconnectCallback = vi.fn()
      await socket2.triggerHandler('reconnect', {
        roomId: 'room-1',
        stablePeerId,
        displayName: 'Alice',
        rtpCapabilities: { codecs: [] },
      }, reconnectCallback)

      expect(reconnectCallback).toHaveBeenCalledWith({
        success: true,
        peers: expect.any(Array),
      })
      expect(peer.id).toBe('socket-2')
      expect(peer.state).toBe('connected')
      expect(getGracePeriodCount()).toBe(0)
    })

    it('returns error if stablePeerId not found', async () => {
      const io = createMockIO()
      const socket = createMockSocket('socket-1')
      setupSignaling(io)
      io.simulateConnection(socket)

      const callback = vi.fn()
      await socket.triggerHandler('reconnect', {
        roomId: 'room-1',
        stablePeerId: 'nonexistent-uuid',
        displayName: 'Alice',
        rtpCapabilities: { codecs: [] },
      }, callback)

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: expect.stringContaining('Peer not found'),
      })
    })
  })
})
