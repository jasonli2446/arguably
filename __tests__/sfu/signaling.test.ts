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

// Import mocked modules
import { getOrCreateRoom, addPeerToRoom, removePeerFromRoom, getRoom } from '../../realtime/src/mediasoup/rooms.js'
import { createWebRtcTransport, getTransportOptions } from '../../realtime/src/mediasoup/transports.js'
import { createProducer } from '../../realtime/src/mediasoup/producers.js'
import { createConsumer } from '../../realtime/src/mediasoup/consumers.js'

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
  return {
    on(event: string, handler: Function) {
      if (event === 'connection') connectionHandler = handler
    },
    simulateConnection(socket: any) {
      if (connectionHandler) connectionHandler(socket)
    },
  }
}

// ── Tests ──

let setupSignaling: any

beforeEach(async () => {
  vi.clearAllMocks()

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
  const { getOrCreateRoom, addPeerToRoom } = await import('../../realtime/src/mediasoup/rooms.js')

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
    it('creates peer, joins room, notifies others, returns existing peers', async () => {
      const socket = setupSocket()
      const { addPeerToRoom } = await import('../../realtime/src/mediasoup/rooms.js')

      // Add an existing peer to the room
      const existingPeer = { id: 'other-socket', displayName: 'OtherUser', transports: new Map(), producers: new Map(), consumers: new Map() }
      mockRoom.peers.set('other-socket', existingPeer)

      const callback = vi.fn()
      await socket.triggerHandler('joinRoom', {
        roomId: 'room-1',
        displayName: 'Alice',
        rtpCapabilities: { codecs: [] },
      }, callback)

      expect(addPeerToRoom).toHaveBeenCalled()
      expect(socket.join).toHaveBeenCalledWith('room-1')
      expect(socket.to).toHaveBeenCalledWith('room-1')
      expect(socket.emit).toHaveBeenCalledWith('peerJoined', {
        peerId: 'socket-1',
        displayName: 'Alice',
      })
      expect(callback).toHaveBeenCalledWith({
        success: true,
        peers: [{ peerId: 'other-socket', displayName: 'OtherUser' }],
      })
    })
  })

  describe('createWebRtcTransport', () => {
    it('creates transport and returns options', async () => {
      const socket = setupSocket()
      await joinSocket(socket)

      // Ensure peer exists in room
      const peer = { id: 'socket-1', displayName: 'TestUser', transports: new Map(), producers: new Map(), consumers: new Map() }
      mockRoom.peers.set('socket-1', peer)

      const callback = vi.fn()
      await socket.triggerHandler('createWebRtcTransport', { direction: 'send' }, callback)

      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        transportOptions: expect.objectContaining({ id: 'transport-1' }),
      }))
      expect(peer.transports.has('transport-1')).toBe(true)
    })

    it('returns error when not in a room', async () => {
      // Fresh socket without joining
      const io = createMockIO()
      const socket = createMockSocket('orphan-socket')

      // Need fresh module that has no socketRoomMap entries
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
    it('connects transport with dtlsParameters', async () => {
      const socket = setupSocket()
      await joinSocket(socket)

      const peer = { id: 'socket-1', displayName: 'TestUser', transports: new Map(), producers: new Map(), consumers: new Map() }
      const transport = { ...mockTransport, connect: vi.fn().mockResolvedValue(undefined) }
      peer.transports.set('transport-1', transport)
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
    it('creates producer, stores it, notifies room, and returns producerId', async () => {
      const socket = setupSocket()
      await joinSocket(socket)

      const peer = { id: 'socket-1', displayName: 'Alice', transports: new Map(), producers: new Map(), consumers: new Map() }
      const transport = { ...mockTransport }
      peer.transports.set('transport-1', transport)
      mockRoom.peers.set('socket-1', peer)

      const { createProducer } = await import('../../realtime/src/mediasoup/producers.js')
      const producer = { id: 'prod-1', kind: 'audio', close: vi.fn(), on: vi.fn() }
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
      expect(socket.to).toHaveBeenCalledWith('room-1')
      expect(socket.emit).toHaveBeenCalledWith('newProducer', {
        producerId: 'prod-1',
        peerId: 'socket-1',
        displayName: 'Alice',
        kind: 'audio',
      })
    })
  })

  describe('consume', () => {
    it('creates consumer and returns consumer data with producer display name', async () => {
      const socket = setupSocket()
      await joinSocket(socket)

      // Set up consuming peer with a recv transport
      const consumerPeer = { id: 'socket-1', displayName: 'Bob', transports: new Map(), producers: new Map(), consumers: new Map() }
      const recvTransport = { id: 'recv-transport', close: vi.fn() }
      consumerPeer.transports.set('recv-transport', recvTransport)
      mockRoom.peers.set('socket-1', consumerPeer)

      // Set up producing peer
      const producerPeer = { id: 'socket-2', displayName: 'Alice', transports: new Map(), producers: new Map(), consumers: new Map() }
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
        kind: 'audio',
        peerId: 'socket-2',
        displayName: 'Alice',
      }))
      expect(consumerPeer.consumers.has('cons-1')).toBe(true)
    })
  })

  describe('resumeConsumer', () => {
    it('resumes the consumer', async () => {
      const socket = setupSocket()
      await joinSocket(socket)

      const consumer = { id: 'cons-1', resume: vi.fn().mockResolvedValue(undefined), on: vi.fn() }
      const peer = { id: 'socket-1', displayName: 'Bob', transports: new Map(), producers: new Map(), consumers: new Map() }
      peer.consumers.set('cons-1', consumer)
      mockRoom.peers.set('socket-1', peer)

      const callback = vi.fn()
      await socket.triggerHandler('resumeConsumer', { consumerId: 'cons-1' }, callback)

      expect(consumer.resume).toHaveBeenCalled()
      expect(callback).toHaveBeenCalledWith({ success: true })
    })

    it('returns error for unknown consumer', async () => {
      const socket = setupSocket()
      await joinSocket(socket)

      const peer = { id: 'socket-1', displayName: 'Bob', transports: new Map(), producers: new Map(), consumers: new Map() }
      mockRoom.peers.set('socket-1', peer)

      const callback = vi.fn()
      await socket.triggerHandler('resumeConsumer', { consumerId: 'nonexistent' }, callback)

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: expect.stringContaining('Consumer not found'),
      })
    })
  })

  describe('closeProducer', () => {
    it('closes producer, deletes it, and notifies room', async () => {
      const socket = setupSocket()
      await joinSocket(socket)

      const producer = { id: 'prod-1', close: vi.fn(), on: vi.fn() }
      const peer = { id: 'socket-1', displayName: 'Alice', transports: new Map(), producers: new Map(), consumers: new Map() }
      peer.producers.set('prod-1', producer)
      mockRoom.peers.set('socket-1', peer)

      const callback = vi.fn()
      await socket.triggerHandler('closeProducer', { producerId: 'prod-1' }, callback)

      expect(producer.close).toHaveBeenCalled()
      expect(peer.producers.has('prod-1')).toBe(false)
      expect(socket.to).toHaveBeenCalledWith('room-1')
      expect(socket.emit).toHaveBeenCalledWith('producerClosed', { producerId: 'prod-1' })
      expect(callback).toHaveBeenCalledWith({ success: true })
    })
  })

  describe('getProducers', () => {
    it('returns all producers from other peers', async () => {
      const socket = setupSocket()
      await joinSocket(socket)

      // Self peer (no producers)
      const selfPeer = { id: 'socket-1', displayName: 'Bob', transports: new Map(), producers: new Map(), consumers: new Map() }
      mockRoom.peers.set('socket-1', selfPeer)

      // Other peer with producers
      const otherPeer = { id: 'socket-2', displayName: 'Alice', transports: new Map(), producers: new Map(), consumers: new Map() }
      otherPeer.producers.set('prod-1', { id: 'prod-1', kind: 'audio' })
      otherPeer.producers.set('prod-2', { id: 'prod-2', kind: 'video' })
      mockRoom.peers.set('socket-2', otherPeer)

      const callback = vi.fn()
      await socket.triggerHandler('getProducers', {}, callback)

      expect(callback).toHaveBeenCalledWith({
        success: true,
        producers: [
          { producerId: 'prod-1', peerId: 'socket-2', displayName: 'Alice', kind: 'audio' },
          { producerId: 'prod-2', peerId: 'socket-2', displayName: 'Alice', kind: 'video' },
        ],
      })
    })

    it('excludes own producers', async () => {
      const socket = setupSocket()
      await joinSocket(socket)

      const selfPeer = { id: 'socket-1', displayName: 'Bob', transports: new Map(), producers: new Map(), consumers: new Map() }
      selfPeer.producers.set('my-prod', { id: 'my-prod', kind: 'audio' })
      mockRoom.peers.set('socket-1', selfPeer)

      const callback = vi.fn()
      await socket.triggerHandler('getProducers', {}, callback)

      expect(callback).toHaveBeenCalledWith({
        success: true,
        producers: [],
      })
    })
  })

  describe('disconnect', () => {
    it('cleans up peer, emits peerLeft, and clears maps', async () => {
      const socket = setupSocket()
      await joinSocket(socket)

      const peer = { id: 'socket-1', displayName: 'Alice', transports: new Map(), producers: new Map(), consumers: new Map() }
      const { removePeerFromRoom } = await import('../../realtime/src/mediasoup/rooms.js')
      vi.mocked(removePeerFromRoom).mockReturnValueOnce(peer as any)

      await socket.triggerHandler('disconnect', undefined)

      expect(removePeerFromRoom).toHaveBeenCalled()
      expect(socket.to).toHaveBeenCalledWith('room-1')
      expect(socket.emit).toHaveBeenCalledWith('peerLeft', {
        peerId: 'socket-1',
        displayName: 'Alice',
      })
    })

    it('handles disconnect when not in a room', async () => {
      const io = createMockIO()
      const socket = createMockSocket('orphan')
      setupSignaling(io)
      io.simulateConnection(socket)

      // Should not throw
      await socket.triggerHandler('disconnect', undefined)

      const { removePeerFromRoom } = await import('../../realtime/src/mediasoup/rooms.js')
      expect(removePeerFromRoom).not.toHaveBeenCalled()
    })
  })
})
