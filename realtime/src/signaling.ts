import { randomUUID } from "node:crypto";
import type { Server as SocketIOServer, Socket } from "socket.io";
import type { Peer } from "./types.js";
import { iceServers } from "./config.js";
import { getOrCreateRoom, addPeerToRoom, removePeerFromRoom, getRoom } from "./mediasoup/rooms.js";
import { createWebRtcTransport, getTransportOptions } from "./mediasoup/transports.js";
import { createProducer } from "./mediasoup/producers.js";
import { createConsumer } from "./mediasoup/consumers.js";
import type { RtpCapabilities } from "mediasoup/types";
import { schemas, validatePayload } from "./validation.js";

// Track which room each socket is in
const socketRoomMap = new Map<string, string>();
const socketPeerMap = new Map<string, { rtpCapabilities: RtpCapabilities }>();

// ── Reconnection state ──
const RECONNECT_GRACE_MS = 30_000;
const socketToPeerId = new Map<string, string>();
const gracePeriodTimers = new Map<string, {
  timer: ReturnType<typeof setTimeout>;
  oldSocketId: string;
  roomId: string;
  displayName: string;
  rtpCapabilities: RtpCapabilities;
}>();

const lastScoreLog = new Map<string, number>();
const SCORE_LOG_INTERVAL_MS = 10_000;

export function getGracePeriodCount(): number {
  return gracePeriodTimers.size;
}

/**
 * Helper to collect all active producers from a room, excluding closed ones.
 */
function collectRoomProducers(room: ReturnType<typeof getRoom>, excludeSocketId: string) {
  const producers: Array<{
    producerId: string;
    peerId: string;
    displayName: string;
    kind: string;
  }> = [];

  if (!room) return producers;

  for (const [, peer] of room.peers) {
    if (peer.id === excludeSocketId || peer.state !== "connected") continue;
    for (const [, producer] of peer.producers) {
      if (!producer.closed) {
        producers.push({
          producerId: producer.id,
          peerId: peer.id,
          displayName: peer.displayName,
          kind: producer.kind,
        });
      }
    }
  }
  return producers;
}

export function setupSignaling(io: SocketIOServer): void {
  io.on("connection", (socket: Socket) => {
    console.log(`Socket connected [id:${socket.id}]`);

    // ── getRouterRtpCapabilities ──
    socket.on("getRouterRtpCapabilities", async (data: unknown, callback) => {
      try {
        const parsed = validatePayload(schemas.getRouterRtpCapabilities, data);
        if (!parsed.success) return callback({ success: false, error: parsed.error });

        const room = await getOrCreateRoom(parsed.data.roomId);
        callback({
          success: true,
          rtpCapabilities: room.router.rtpCapabilities,
          iceServers,
        });
      } catch (error) {
        console.error("getRouterRtpCapabilities error:", error);
        callback({ success: false, error: String(error) });
      }
    });

    // ── joinRoom ──
    socket.on("joinRoom", async (data: unknown, callback) => {
      try {
        const parsed = validatePayload(schemas.joinRoom, data);
        if (!parsed.success) return callback({ success: false, error: parsed.error });

        const { roomId, displayName, rtpCapabilities } = parsed.data;
        const room = await getOrCreateRoom(roomId);

        const stablePeerId = randomUUID();

        const peer: Peer = {
          id: socket.id,
          stablePeerId,
          displayName,
          state: "connected",
          transports: new Map(),
          producers: new Map(),
          consumers: new Map(),
        };

        addPeerToRoom(room, peer);
        socketRoomMap.set(socket.id, roomId);
        socketPeerMap.set(socket.id, { rtpCapabilities: rtpCapabilities as RtpCapabilities });
        socketToPeerId.set(socket.id, stablePeerId);

        // Join socket.io room for broadcasting
        socket.join(roomId);

        // Notify other peers
        socket.to(roomId).emit("peerJoined", {
          peerId: socket.id,
          displayName,
        });

        // Return list of existing peers (only connected)
        const existingPeers = Array.from(room.peers.values())
          .filter((p) => p.id !== socket.id && p.state === "connected")
          .map((p) => ({ peerId: p.id, displayName: p.displayName }));

        callback({ success: true, peers: existingPeers, stablePeerId });
      } catch (error) {
        console.error("joinRoom error:", error);
        callback({ success: false, error: String(error) });
      }
    });

    // ── reconnect ──
    socket.on("reconnect", async (data: unknown, callback) => {
      try {
        const parsed = validatePayload(schemas.reconnect, data);
        if (!parsed.success) return callback({ success: false, error: parsed.error });

        const { roomId, stablePeerId, displayName, rtpCapabilities } = parsed.data;
        const room = getRoom(roomId);
        if (!room) throw new Error("Room not found");

        // Find peer by stablePeerId
        let oldPeer: Peer | undefined;
        for (const [, peer] of room.peers) {
          if (peer.stablePeerId === stablePeerId) {
            oldPeer = peer;
            break;
          }
        }

        if (!oldPeer) throw new Error("Peer not found for reconnection");

        // Cancel grace period timer if active
        const graceEntry = gracePeriodTimers.get(stablePeerId);
        if (graceEntry) {
          clearTimeout(graceEntry.timer);
          gracePeriodTimers.delete(stablePeerId);
          console.log(`Reconnection within grace period [stablePeerId:${stablePeerId}]`);
        }

        // Update peer with new socket ID
        room.peers.delete(oldPeer.id);
        oldPeer.id = socket.id;
        oldPeer.state = "connected";
        room.peers.set(socket.id, oldPeer);

        // Update maps
        socketRoomMap.set(socket.id, roomId);
        socketPeerMap.set(socket.id, { rtpCapabilities: rtpCapabilities as RtpCapabilities });
        socketToPeerId.set(socket.id, stablePeerId);

        // Join socket.io room
        socket.join(roomId);

        // Notify room of reconnection
        socket.to(roomId).emit("peerReconnected", {
          peerId: socket.id,
          displayName,
        });

        // Return existing peers (only connected)
        const existingPeers = Array.from(room.peers.values())
          .filter((p) => p.id !== socket.id && p.state === "connected")
          .map((p) => ({ peerId: p.id, displayName: p.displayName }));

        callback({ success: true, peers: existingPeers });
      } catch (error) {
        console.error("reconnect error:", error);
        callback({ success: false, error: String(error) });
      }
    });

    // ── createWebRtcTransport ──
    socket.on("createWebRtcTransport", async (data: unknown, callback) => {
      try {
        const parsed = validatePayload(schemas.createWebRtcTransport, data);
        if (!parsed.success) return callback({ success: false, error: parsed.error });

        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) throw new Error("Not in a room");

        const room = getRoom(roomId);
        if (!room) throw new Error("Room not found");

        const peer = room.peers.get(socket.id);
        if (!peer) throw new Error("Peer not found");

        const transport = await createWebRtcTransport(room.router);

        transport.on("dtlsstatechange", (dtlsState: string) => {
          console.log(`Transport [id:${transport.id}, direction:${parsed.data.direction}] dtls state: ${dtlsState}`);

          if (dtlsState === "closed" || dtlsState === "failed") {
            // Notify client of transport failure
            socket.emit("transportFailure", {
              transportId: transport.id,
              direction: parsed.data.direction,
              reason: `DTLS state: ${dtlsState}`,
            });

            // Clean up transport
            const transportInfo = peer.transports.get(transport.id);
            if (transportInfo) {
              peer.transports.delete(transport.id);
            }
            transport.close();
          }
        });

        peer.transports.set(transport.id, {
          transport,
          direction: parsed.data.direction
        });

        callback({
          success: true,
          transportOptions: getTransportOptions(transport),
        });
      } catch (error) {
        console.error("createWebRtcTransport error:", error);
        callback({ success: false, error: String(error) });
      }
    });

    // ── connectTransport ──
    socket.on("connectTransport", async (data: unknown, callback) => {
      try {
        const parsed = validatePayload(schemas.connectTransport, data);
        if (!parsed.success) return callback({ success: false, error: parsed.error });

        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) throw new Error("Not in a room");

        const room = getRoom(roomId);
        if (!room) throw new Error("Room not found");

        const peer = room.peers.get(socket.id);
        if (!peer) throw new Error("Peer not found");

        const transportInfo = peer.transports.get(parsed.data.transportId);
        if (!transportInfo) throw new Error("Transport not found");

        await transportInfo.transport.connect({
          dtlsParameters: parsed.data.dtlsParameters,
        } as Parameters<typeof transportInfo.transport.connect>[0]);

        callback({ success: true });
      } catch (error) {
        console.error("connectTransport error:", error);
        callback({ success: false, error: String(error) });
      }
    });

    // ── produce ──
    socket.on("produce", async (data: unknown, callback) => {
      try {
        const parsed = validatePayload(schemas.produce, data);
        if (!parsed.success) return callback({ success: false, error: parsed.error });

        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) throw new Error("Not in a room");

        const room = getRoom(roomId);
        if (!room) throw new Error("Room not found");

        const peer = room.peers.get(socket.id);
        if (!peer) throw new Error("Peer not found");

        const transportInfo = peer.transports.get(parsed.data.transportId);
        if (!transportInfo) throw new Error("Transport not found");

        const producer = await createProducer(
          transportInfo.transport,
          parsed.data.kind,
          parsed.data.rtpParameters as Parameters<typeof createProducer>[2],
          parsed.data.appData,
        );

        peer.producers.set(producer.id, producer);

        producer.on("transportclose", () => {
          peer.producers.delete(producer.id);
        });

        // Monitor producer quality with throttled logging
        producer.on("score", (score: any) => {
          const now = Date.now();
          const lastLog = lastScoreLog.get(producer.id) || 0;
          if (now - lastLog >= SCORE_LOG_INTERVAL_MS) {
            console.log(`Producer [id:${producer.id}, kind:${producer.kind}] score:`, score);
            lastScoreLog.set(producer.id, now);
          }
        });

        // Notify other peers about the new producer
        socket.to(roomId).emit("newProducer", {
          producerId: producer.id,
          peerId: socket.id,
          displayName: peer.displayName,
          kind: producer.kind,
        });

        callback({ success: true, producerId: producer.id });
      } catch (error) {
        console.error("produce error:", error);
        callback({ success: false, error: String(error) });
      }
    });

    // ── consume ──
    socket.on("consume", async (data: unknown, callback) => {
      try {
        const parsed = validatePayload(schemas.consume, data);
        if (!parsed.success) return callback({ success: false, error: parsed.error });

        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) throw new Error("Not in a room");

        const room = getRoom(roomId);
        if (!room) throw new Error("Room not found");

        const peer = room.peers.get(socket.id);
        if (!peer) throw new Error("Peer not found");

        const peerData = socketPeerMap.get(socket.id);
        if (!peerData) throw new Error("Peer RTP capabilities not found");

        // Find recv transport by direction
        let recvTransportInfo;
        for (const [, tInfo] of peer.transports) {
          if (tInfo.direction === "recv") {
            recvTransportInfo = tInfo;
            break;
          }
        }
        if (!recvTransportInfo) throw new Error("Recv transport not found");

        // Find the producer's peer for display name (validate producer exists)
        let producerPeerId = "";
        let producerDisplayName = "";
        for (const [, roomPeer] of room.peers) {
          if (roomPeer.producers.has(parsed.data.producerId)) {
            producerPeerId = roomPeer.id;
            producerDisplayName = roomPeer.displayName;
            break;
          }
        }

        if (!producerPeerId) {
          throw new Error(`Producer ${parsed.data.producerId} not found in room`);
        }

        const consumer = await createConsumer(
          room.router,
          recvTransportInfo.transport,
          parsed.data.producerId,
          peerData.rtpCapabilities,
        );

        peer.consumers.set(consumer.id, consumer);

        consumer.on("transportclose", () => {
          peer.consumers.delete(consumer.id);
        });

        consumer.on("producerclose", () => {
          peer.consumers.delete(consumer.id);
          socket.emit("producerClosed", { producerId: parsed.data.producerId });
        });

        // Monitor consumer quality with throttled logging
        consumer.on("score", (score: any) => {
          const now = Date.now();
          const lastLog = lastScoreLog.get(consumer.id) || 0;
          if (now - lastLog >= SCORE_LOG_INTERVAL_MS) {
            console.log(`Consumer [id:${consumer.id}, kind:${consumer.kind}] score:`, score);
            lastScoreLog.set(consumer.id, now);
          }
        });

        callback({
          success: true,
          id: consumer.id,
          producerId: parsed.data.producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
          peerId: producerPeerId,
          displayName: producerDisplayName,
        });
      } catch (error) {
        console.error("consume error:", error);
        callback({ success: false, error: String(error) });
      }
    });

    // ── resumeConsumer ──
    socket.on("resumeConsumer", async (data: unknown, callback) => {
      try {
        const parsed = validatePayload(schemas.resumeConsumer, data);
        if (!parsed.success) return callback({ success: false, error: parsed.error });

        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) throw new Error("Not in a room");

        const room = getRoom(roomId);
        if (!room) throw new Error("Room not found");

        const peer = room.peers.get(socket.id);
        if (!peer) throw new Error("Peer not found");

        const consumer = peer.consumers.get(parsed.data.consumerId);
        if (!consumer) throw new Error("Consumer not found");

        await consumer.resume();
        callback({ success: true });
      } catch (error) {
        console.error("resumeConsumer error:", error);
        callback({ success: false, error: String(error) });
      }
    });

    // ── closeProducer ──
    socket.on("closeProducer", async (data: unknown, callback) => {
      try {
        const parsed = validatePayload(schemas.closeProducer, data);
        if (!parsed.success) return callback({ success: false, error: parsed.error });

        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) throw new Error("Not in a room");

        const room = getRoom(roomId);
        if (!room) throw new Error("Room not found");

        const peer = room.peers.get(socket.id);
        if (!peer) throw new Error("Peer not found");

        const producer = peer.producers.get(parsed.data.producerId);
        if (!producer) throw new Error("Producer not found");

        producer.close();
        peer.producers.delete(parsed.data.producerId);

        // Notify other peers
        socket.to(roomId).emit("producerClosed", {
          producerId: parsed.data.producerId,
        });

        callback({ success: true });
      } catch (error) {
        console.error("closeProducer error:", error);
        callback({ success: false, error: String(error) });
      }
    });

    // ── getProducers ──
    socket.on("getProducers", async (data: unknown, callback) => {
      try {
        validatePayload(schemas.getProducers, data);

        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) throw new Error("Not in a room");

        const room = getRoom(roomId);
        if (!room) throw new Error("Room not found");

        const producers = collectRoomProducers(room, socket.id);

        callback({ success: true, producers });
      } catch (error) {
        console.error("getProducers error:", error);
        callback({ success: false, error: String(error) });
      }
    });

    // ── disconnect ──
    socket.on("disconnect", () => {
      console.log(`Socket disconnected [id:${socket.id}]`);

      const roomId = socketRoomMap.get(socket.id);
      const stablePeerId = socketToPeerId.get(socket.id);

      if (!roomId || !stablePeerId) {
        // No room/peer state — immediate cleanup
        socketRoomMap.delete(socket.id);
        socketPeerMap.delete(socket.id);
        socketToPeerId.delete(socket.id);
        return;
      }

      const room = getRoom(roomId);
      if (!room) {
        socketRoomMap.delete(socket.id);
        socketPeerMap.delete(socket.id);
        socketToPeerId.delete(socket.id);
        return;
      }

      const peer = room.peers.get(socket.id);
      if (!peer) {
        socketRoomMap.delete(socket.id);
        socketPeerMap.delete(socket.id);
        socketToPeerId.delete(socket.id);
        return;
      }

      // Mark peer as in grace period
      peer.state = "grace";

      // Notify room that peer is reconnecting
      socket.to(roomId).emit("peerReconnecting", {
        peerId: socket.id,
        displayName: peer.displayName,
      });

      const peerData = socketPeerMap.get(socket.id);

      // Start grace period timer
      const timer = setTimeout(() => {
        console.log(`Grace period expired [stablePeerId:${stablePeerId}]`);
        gracePeriodTimers.delete(stablePeerId);

        const currentRoom = getRoom(roomId);
        if (currentRoom) {
          const expiredPeer = removePeerFromRoom(currentRoom, socket.id);
          if (expiredPeer) {
            io.to(roomId).emit("peerLeft", {
              peerId: socket.id,
              displayName: expiredPeer.displayName,
            });
          }
        }

        socketRoomMap.delete(socket.id);
        socketPeerMap.delete(socket.id);
        socketToPeerId.delete(socket.id);
      }, RECONNECT_GRACE_MS);

      gracePeriodTimers.set(stablePeerId, {
        timer,
        oldSocketId: socket.id,
        roomId,
        displayName: peer.displayName,
        rtpCapabilities: peerData?.rtpCapabilities || { codecs: [] },
      });

      console.log(`Grace period started [stablePeerId:${stablePeerId}, duration:${RECONNECT_GRACE_MS}ms]`);
    });
  });
}
