import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'
import { Server as SocketIOServer } from 'socket.io'
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client'

// ── Mock mediasoup internals (we test signaling, not media) ──

const mockRouter = {
  rtpCapabilities: { codecs: [{ mimeType: 'audio/opus' }] },
  canConsume: vi.fn().mockReturnValue(true),
  close: vi.fn(),
}

const mockWorker = {
  createRouter: vi.fn().mockResolvedValue(mockRouter),
}

vi.mock('../../realtime/src/config.js', () => ({
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  routerOptions: {
    mediaCodecs: [
      { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
    ],
  },
}))

vi.mock('../../realtime/src/mediasoup/workers.js', () => ({
  getNextWorker: vi.fn(() => mockWorker),
}))

// Use real rooms/transports/producers/consumers but with mocked mediasoup worker
// Actually, we need to mock transports too since they need real mediasoup
let transportIdCounter = 0
const mockTransports = new Map<string, any>()

vi.mock('../../realtime/src/mediasoup/transports.js', () => ({
  createWebRtcTransport: vi.fn().mockImplementation(async () => {
    const id = `transport-${++transportIdCounter}`
    const transport = {
      id,
      close: vi.fn(),
      connect: vi.fn(),
      on: vi.fn(),
    }
    mockTransports.set(id, transport)
    return transport
  }),
  getTransportOptions: vi.fn().mockImplementation((transport: any) => ({
    id: transport.id,
    iceParameters: { usernameFragment: 'test', password: 'test' },
    iceCandidates: [],
    dtlsParameters: { fingerprints: [] },
  })),
}))

let producerIdCounter = 0

vi.mock('../../realtime/src/mediasoup/producers.js', () => ({
  createProducer: vi.fn().mockImplementation(async (_transport: any, kind: string) => {
    const id = `producer-${++producerIdCounter}`
    const producer = { id, kind, close: vi.fn(), on: vi.fn() }
    return producer
  }),
}))

vi.mock('../../realtime/src/mediasoup/consumers.js', () => ({
  createConsumer: vi.fn().mockImplementation(async (_router: any, _transport: any, producerId: string) => {
    const id = `consumer-${producerIdCounter}`
    const consumer = {
      id,
      kind: 'audio',
      rtpParameters: { codecs: [] },
      producerId,
      resume: vi.fn(),
      close: vi.fn(),
      on: vi.fn(),
    }
    return consumer
  }),
}))

import { setupSignaling } from '../../realtime/src/signaling.js'

// ── Server setup ──

let httpServer: http.Server
let ioServer: SocketIOServer
let port: number
const clients: ClientSocket[] = []

function createTestClient(): Promise<ClientSocket> {
  return new Promise((resolve) => {
    const client = ioClient(`http://localhost:${port}`, {
      transports: ['websocket'],
    })
    clients.push(client)
    client.on('connect', () => resolve(client))
  })
}

function emitWithAck(client: ClientSocket, event: string, data: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    client.emit(event, data, (response: any) => {
      if (response.success) resolve(response)
      else reject(new Error(response.error || 'Request failed'))
    })
  })
}

beforeAll(async () => {
  httpServer = http.createServer()
  ioServer = new SocketIOServer(httpServer, {
    cors: { origin: '*' },
  })
  setupSignaling(ioServer)

  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      port = (httpServer.address() as any).port
      resolve()
    })
  })
})

afterAll(async () => {
  for (const client of clients) {
    client.disconnect()
  }
  ioServer.close()
  httpServer.close()
})

beforeEach(() => {
  transportIdCounter = 0
  producerIdCounter = 0
  mockTransports.clear()
  vi.clearAllMocks()
  mockRouter.canConsume.mockReturnValue(true)
})

describe('Signaling Integration', () => {
  it('client connects and gets router capabilities', async () => {
    const client = await createTestClient()

    const response = await emitWithAck(client, 'getRouterRtpCapabilities', { roomId: 'int-room-1' })

    expect(response.success).toBe(true)
    expect(response.rtpCapabilities).toBeDefined()
    expect(response.iceServers).toBeDefined()
  })

  it('two clients join, first receives peerJoined', async () => {
    const client1 = await createTestClient()
    const client2 = await createTestClient()

    // Client 1 joins
    await emitWithAck(client1, 'getRouterRtpCapabilities', { roomId: 'int-room-2' })
    await emitWithAck(client1, 'joinRoom', {
      roomId: 'int-room-2',
      displayName: 'Alice',
      rtpCapabilities: { codecs: [] },
    })

    // Listen for peerJoined on client1
    const peerJoinedPromise = new Promise<any>((resolve) => {
      client1.on('peerJoined', resolve)
    })

    // Client 2 joins
    await emitWithAck(client2, 'getRouterRtpCapabilities', { roomId: 'int-room-2' })
    const joinResponse = await emitWithAck(client2, 'joinRoom', {
      roomId: 'int-room-2',
      displayName: 'Bob',
      rtpCapabilities: { codecs: [] },
    })

    // Client 2 should see client 1 in peers list
    expect(joinResponse.peers.length).toBe(1)
    expect(joinResponse.peers[0].displayName).toBe('Alice')

    // Client 1 should receive peerJoined event
    const peerJoinedData = await peerJoinedPromise
    expect(peerJoinedData.displayName).toBe('Bob')
  })

  it('full produce/consume flow between two clients', async () => {
    const client1 = await createTestClient()
    const client2 = await createTestClient()
    const roomId = 'int-room-3'

    // Both clients join
    await emitWithAck(client1, 'getRouterRtpCapabilities', { roomId })
    await emitWithAck(client1, 'joinRoom', {
      roomId,
      displayName: 'Alice',
      rtpCapabilities: { codecs: [] },
    })

    await emitWithAck(client2, 'getRouterRtpCapabilities', { roomId })
    await emitWithAck(client2, 'joinRoom', {
      roomId,
      displayName: 'Bob',
      rtpCapabilities: { codecs: [] },
    })

    // Client 1 creates send transport
    const sendTransportData = await emitWithAck(client1, 'createWebRtcTransport', { direction: 'send' })
    expect(sendTransportData.transportOptions.id).toBeDefined()

    // Client 1 produces
    const produceData = await emitWithAck(client1, 'produce', {
      transportId: sendTransportData.transportOptions.id,
      kind: 'audio',
      rtpParameters: {},
      appData: {},
    })
    expect(produceData.producerId).toBeDefined()

    // Client 2 creates recv transport
    await emitWithAck(client2, 'createWebRtcTransport', { direction: 'recv' })

    // Client 2 gets producers list
    const producersData = await emitWithAck(client2, 'getProducers')
    expect(producersData.producers.length).toBeGreaterThanOrEqual(1)

    const targetProducer = producersData.producers.find(
      (p: any) => p.producerId === produceData.producerId
    )
    expect(targetProducer).toBeDefined()
    expect(targetProducer.displayName).toBe('Alice')

    // Client 2 consumes
    const consumeData = await emitWithAck(client2, 'consume', {
      producerId: produceData.producerId,
    })
    expect(consumeData.displayName).toBe('Alice')
    expect(consumeData.kind).toBe('audio')

    // Client 2 resumes consumer
    const resumeResult = await emitWithAck(client2, 'resumeConsumer', {
      consumerId: consumeData.id,
    })
    expect(resumeResult.success).toBe(true)
  })

  it('disconnect triggers peerLeft for remaining client', async () => {
    const client1 = await createTestClient()
    const client2 = await createTestClient()
    const roomId = 'int-room-4'

    // Both join
    await emitWithAck(client1, 'getRouterRtpCapabilities', { roomId })
    await emitWithAck(client1, 'joinRoom', {
      roomId,
      displayName: 'Alice',
      rtpCapabilities: { codecs: [] },
    })

    await emitWithAck(client2, 'getRouterRtpCapabilities', { roomId })
    await emitWithAck(client2, 'joinRoom', {
      roomId,
      displayName: 'Bob',
      rtpCapabilities: { codecs: [] },
    })

    // Listen for peerLeft on client1
    const peerLeftPromise = new Promise<any>((resolve) => {
      client1.on('peerLeft', resolve)
    })

    // Client 2 disconnects
    client2.disconnect()

    const peerLeftData = await peerLeftPromise
    expect(peerLeftData.displayName).toBe('Bob')
  })

  it('returns error when emitting before joining a room', async () => {
    const client = await createTestClient()

    await expect(
      emitWithAck(client, 'createWebRtcTransport', { direction: 'send' })
    ).rejects.toThrow('Not in a room')
  })

  it('closeProducer notifies other peers', async () => {
    const client1 = await createTestClient()
    const client2 = await createTestClient()
    const roomId = 'int-room-5'

    // Both join
    await emitWithAck(client1, 'getRouterRtpCapabilities', { roomId })
    await emitWithAck(client1, 'joinRoom', {
      roomId,
      displayName: 'Alice',
      rtpCapabilities: { codecs: [] },
    })

    await emitWithAck(client2, 'getRouterRtpCapabilities', { roomId })
    await emitWithAck(client2, 'joinRoom', {
      roomId,
      displayName: 'Bob',
      rtpCapabilities: { codecs: [] },
    })

    // Client 1 creates transport and produces
    const transportData = await emitWithAck(client1, 'createWebRtcTransport', { direction: 'send' })
    const produceData = await emitWithAck(client1, 'produce', {
      transportId: transportData.transportOptions.id,
      kind: 'audio',
      rtpParameters: {},
      appData: {},
    })

    // Listen for producerClosed on client 2
    const producerClosedPromise = new Promise<any>((resolve) => {
      client2.on('producerClosed', resolve)
    })

    // Client 1 closes producer
    await emitWithAck(client1, 'closeProducer', { producerId: produceData.producerId })

    const closedData = await producerClosedPromise
    expect(closedData.producerId).toBe(produceData.producerId)
  })
})
