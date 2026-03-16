import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the dependencies before importing the module
vi.mock('../../realtime/src/config.js', () => ({
  routerOptions: {
    mediaCodecs: [
      { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
    ],
  },
}))

const mockRouter = {
  rtpCapabilities: {},
  close: vi.fn(),
}

const mockWorker = {
  createRouter: vi.fn().mockResolvedValue(mockRouter),
}

vi.mock('../../realtime/src/mediasoup/workers.js', () => ({
  getNextWorker: vi.fn(() => mockWorker),
}))

// Use dynamic import to get fresh module per test
let getOrCreateRoom: any
let addPeerToRoom: any
let removePeerFromRoom: any
let getRoom: any

beforeEach(async () => {
  vi.clearAllMocks()
  // Reset module to clear the rooms Map
  vi.resetModules()

  // Re-setup mocks after resetModules
  vi.doMock('../../realtime/src/config.js', () => ({
    routerOptions: {
      mediaCodecs: [
        { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
      ],
    },
  }))

  vi.doMock('../../realtime/src/mediasoup/workers.js', () => ({
    getNextWorker: vi.fn(() => mockWorker),
  }))

  const mod = await import('../../realtime/src/mediasoup/rooms.js')
  getOrCreateRoom = mod.getOrCreateRoom
  addPeerToRoom = mod.addPeerToRoom
  removePeerFromRoom = mod.removePeerFromRoom
  getRoom = mod.getRoom
})

function makePeer(id: string, displayName = 'TestUser') {
  return {
    id,
    displayName,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
  }
}

describe('getOrCreateRoom', () => {
  it('creates a new room with a router', async () => {
    const room = await getOrCreateRoom('room-1')
    expect(room.id).toBe('room-1')
    expect(room.router).toBe(mockRouter)
    expect(room.peers.size).toBe(0)
  })

  it('returns existing room on second call', async () => {
    const room1 = await getOrCreateRoom('room-1')
    const room2 = await getOrCreateRoom('room-1')
    expect(room1).toBe(room2)
    expect(mockWorker.createRouter).toHaveBeenCalledTimes(1)
  })

  it('creates different rooms for different IDs', async () => {
    const roomA = await getOrCreateRoom('a')
    const roomB = await getOrCreateRoom('b')
    expect(roomA).not.toBe(roomB)
    expect(mockWorker.createRouter).toHaveBeenCalledTimes(2)
  })
})

describe('addPeerToRoom', () => {
  it('adds a peer to the room', async () => {
    const room = await getOrCreateRoom('room-1')
    const peer = makePeer('peer-1', 'Alice')
    addPeerToRoom(room, peer)
    expect(room.peers.size).toBe(1)
    expect(room.peers.get('peer-1')).toBe(peer)
  })

  it('supports multiple peers', async () => {
    const room = await getOrCreateRoom('room-1')
    addPeerToRoom(room, makePeer('p1', 'Alice'))
    addPeerToRoom(room, makePeer('p2', 'Bob'))
    expect(room.peers.size).toBe(2)
  })
})

describe('removePeerFromRoom', () => {
  it('returns undefined if peer not found', async () => {
    const room = await getOrCreateRoom('room-1')
    const result = removePeerFromRoom(room, 'nonexistent')
    expect(result).toBeUndefined()
  })

  it('removes the peer and closes its transports', async () => {
    const room = await getOrCreateRoom('room-1')
    const peer = makePeer('peer-1')
    const mockTransport = { close: vi.fn() }
    peer.transports.set('t1', mockTransport as any)
    addPeerToRoom(room, peer)

    const removed = removePeerFromRoom(room, 'peer-1')
    expect(removed).toBe(peer)
    expect(room.peers.has('peer-1')).toBe(false)
    expect(mockTransport.close).toHaveBeenCalled()
  })

  it('closes router and deletes room when last peer leaves', async () => {
    const room = await getOrCreateRoom('room-1')
    addPeerToRoom(room, makePeer('peer-1'))
    removePeerFromRoom(room, 'peer-1')
    expect(mockRouter.close).toHaveBeenCalled()
    expect(getRoom('room-1')).toBeUndefined()
  })

  it('does NOT close room when other peers remain', async () => {
    const room = await getOrCreateRoom('room-1')
    addPeerToRoom(room, makePeer('p1'))
    addPeerToRoom(room, makePeer('p2'))
    removePeerFromRoom(room, 'p1')
    expect(mockRouter.close).not.toHaveBeenCalled()
    expect(getRoom('room-1')).toBeDefined()
  })
})

describe('getRoom', () => {
  it('returns undefined for nonexistent room', () => {
    expect(getRoom('nope')).toBeUndefined()
  })

  it('returns the room after creation', async () => {
    await getOrCreateRoom('room-x')
    expect(getRoom('room-x')).toBeDefined()
    expect(getRoom('room-x')!.id).toBe('room-x')
  })
})
