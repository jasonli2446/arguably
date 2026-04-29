import type { Room, Peer } from "../types.js";
import { routerOptions } from "../config.js";
import { getNextWorker } from "./workers.js";

const rooms = new Map<string, Room>();

/** Gets an existing mediasoup room or creates one with a router on the next worker. */
export async function getOrCreateRoom(roomId: string): Promise<Room> {
  let room = rooms.get(roomId);
  if (room) return room;

  const worker = getNextWorker();
  const router = await worker.createRouter(routerOptions);

  room = {
    id: roomId,
    router,
    peers: new Map(),
  };

  rooms.set(roomId, room);
  console.log(`Room created [id:${roomId}]`);
  return room;
}

/** Adds a peer to a room registry. */
export function addPeerToRoom(room: Room, peer: Peer): void {
  room.peers.set(peer.id, peer);
  console.log(`Peer joined room [room:${room.id}, peer:${peer.id}, name:${peer.displayName}]`);
}

/** Removes a peer, closes its transports, and auto-closes the room when empty. */
export function removePeerFromRoom(room: Room, peerId: string): Peer | undefined {
  const peer = room.peers.get(peerId);
  if (!peer) return undefined;

  // Close all transports (which closes producers and consumers too)
  for (const { transport } of peer.transports.values()) {
    transport.close();
  }

  room.peers.delete(peerId);
  console.log(`Peer left room [room:${room.id}, peer:${peerId}]`);

  // Auto-close room when empty
  if (room.peers.size === 0) {
    room.router.close();
    rooms.delete(room.id);
    console.log(`Room closed (empty) [id:${room.id}]`);
  }

  return peer;
}

/** Returns a room by id without creating it. */
export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

/** Closes and removes a room by id. */
export function deleteRoom(roomId: string): void {
  const room = rooms.get(roomId);
  if (room) {
    room.router.close();
    rooms.delete(roomId);
    console.log(`Room manually deleted [id:${roomId}]`);
  }
}

/** Returns the current number of in-memory rooms. */
export function getRoomCount(): number {
  return rooms.size;
}

/** Returns lightweight room stats for debug endpoints. */
export function getAllRoomStats(): Array<{ roomId: string; peerCount: number }> {
  return Array.from(rooms.entries()).map(([roomId, room]) => ({
    roomId,
    peerCount: room.peers.size,
  }));
}
