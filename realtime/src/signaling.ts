import type { Server as SocketIOServer, Socket } from "socket.io";
import type {
  Peer,
  JoinDebateRoomRequest,
  StartDebateRequest,
  NextTurnRequest,
  PauseDebateRequest,
  ResumeDebateRequest,
  EndDebateRequest,
  GetDebateStateRequest,
} from "./types.js";
import { iceServers } from "./config.js";
import { getOrCreateRoom, addPeerToRoom, removePeerFromRoom, getRoom } from "./mediasoup/rooms.js";
import { createWebRtcTransport, getTransportOptions } from "./mediasoup/transports.js";
import { createProducer } from "./mediasoup/producers.js";
import { createConsumer } from "./mediasoup/consumers.js";
import type { RtpCapabilities } from "mediasoup/types";
import { schemas, validatePayload } from "./validation.js";
import {
  startDebate,
  advanceTurn,
  pauseDebate,
  resumeDebate,
  endDebate,
  getOrLoadState,
  checkAuthorization,
  handleSpeakerDisconnect,
} from "./debate.js";

// Track which room each socket is in
const socketRoomMap = new Map<string, string>();
const socketPeerMap = new Map<string, { rtpCapabilities: RtpCapabilities }>();
const socketUserMap = new Map<string, string>();
const socketDebateRoomMap = new Map<string, string>();

export function setupSignaling(io: SocketIOServer): void {
  io.on("connection", (socket: Socket) => {
    console.log(`Socket connected [id:${socket.id}]`);

    // Extract userId from auth handshake
    const authUserId = (socket.handshake.auth as Record<string, unknown>)?.userId as string | undefined;
    if (authUserId) socketUserMap.set(socket.id, authUserId);

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

        const peer: Peer = {
          id: socket.id,
          displayName,
          userId: authUserId,
          transports: new Map(),
          producers: new Map(),
          consumers: new Map(),
        };

        addPeerToRoom(room, peer);
        socketRoomMap.set(socket.id, roomId);
        socketPeerMap.set(socket.id, { rtpCapabilities: rtpCapabilities as RtpCapabilities });

        // Join socket.io room for broadcasting
        socket.join(roomId);

        // Notify other peers
        socket.to(roomId).emit("peerJoined", {
          peerId: socket.id,
          displayName,
        });

        // Return list of existing peers
        const existingPeers = Array.from(room.peers.values())
          .filter((p) => p.id !== socket.id)
          .map((p) => ({ peerId: p.id, displayName: p.displayName }));

        callback({ success: true, peers: existingPeers });
      } catch (error) {
        console.error("joinRoom error:", error);
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
          if (dtlsState === "closed" || dtlsState === "failed") {
            transport.close();
          }
        });

        peer.transports.set(transport.id, transport);

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

        const transport = peer.transports.get(parsed.data.transportId);
        if (!transport) throw new Error("Transport not found");

        await transport.connect({
          dtlsParameters: parsed.data.dtlsParameters,
        } as Parameters<typeof transport.connect>[0]);

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

        const transport = peer.transports.get(parsed.data.transportId);
        if (!transport) throw new Error("Transport not found");

        const producer = await createProducer(
          transport,
          parsed.data.kind,
          parsed.data.rtpParameters as Parameters<typeof createProducer>[2],
          parsed.data.appData,
        );

        peer.producers.set(producer.id, producer);

        producer.on("transportclose", () => {
          peer.producers.delete(producer.id);
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

        // Use the last transport (recv transport is created second)
        const transports = Array.from(peer.transports.values());
        const transport = transports[transports.length - 1];
        if (!transport) throw new Error("Recv transport not found");

        // Find the producer's peer for display name
        let producerPeerId = "";
        let producerDisplayName = "";
        for (const [, roomPeer] of room.peers) {
          if (roomPeer.producers.has(parsed.data.producerId)) {
            producerPeerId = roomPeer.id;
            producerDisplayName = roomPeer.displayName;
            break;
          }
        }

        const consumer = await createConsumer(
          room.router,
          transport,
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

        const producers: Array<{
          producerId: string;
          peerId: string;
          displayName: string;
          kind: string;
        }> = [];

        for (const [, peer] of room.peers) {
          if (peer.id === socket.id) continue;
          for (const [, producer] of peer.producers) {
            producers.push({
              producerId: producer.id,
              peerId: peer.id,
              displayName: peer.displayName,
              kind: producer.kind,
            });
          }
        }

        callback({ success: true, producers });
      } catch (error) {
        console.error("getProducers error:", error);
        callback({ success: false, error: String(error) });
      }
    });

    // ══════════════════════════════════════════
    // ── DEBATE EVENTS ──
    // ══════════════════════════════════════════

    socket.on("joinDebateRoom", (data: JoinDebateRoomRequest, callback) => {
      try {
        socket.join(data.roomCode);
        socketDebateRoomMap.set(socket.id, data.roomCode);
        callback({ success: true });
      } catch (error) {
        callback({ success: false, error: String(error) });
      }
    });

    socket.on("startDebate", async (data: StartDebateRequest, callback) => {
      try {
        const userId = socketUserMap.get(socket.id);
        if (!userId) throw new Error("Not authenticated");
        const authorized = await checkAuthorization(data.roomCode, userId);
        if (!authorized) throw new Error("Not authorized");
        const result = await startDebate(data.roomCode, data.debaters, data.turnLength, data.format, data.formatMeta ?? null, io);
        callback(result);
      } catch (error) {
        callback({ success: false, error: String(error) });
      }
    });

    socket.on("nextTurn", async (data: NextTurnRequest, callback) => {
      try {
        const userId = socketUserMap.get(socket.id);
        if (!userId) throw new Error("Not authenticated");
        const authorized = await checkAuthorization(data.roomCode, userId);
        if (!authorized) throw new Error("Not authorized");
        const result = await advanceTurn(data.roomCode, "MANUAL_ADVANCE", io, data.version);
        callback(result);
      } catch (error) {
        callback({ success: false, error: String(error) });
      }
    });

    socket.on("pauseDebate", async (data: PauseDebateRequest, callback) => {
      try {
        const userId = socketUserMap.get(socket.id);
        if (!userId) throw new Error("Not authenticated");
        const authorized = await checkAuthorization(data.roomCode, userId);
        if (!authorized) throw new Error("Not authorized");
        const result = await pauseDebate(data.roomCode, io);
        callback(result);
      } catch (error) {
        callback({ success: false, error: String(error) });
      }
    });

    socket.on("resumeDebate", async (data: ResumeDebateRequest, callback) => {
      try {
        const userId = socketUserMap.get(socket.id);
        if (!userId) throw new Error("Not authenticated");
        const authorized = await checkAuthorization(data.roomCode, userId);
        if (!authorized) throw new Error("Not authorized");
        const result = await resumeDebate(data.roomCode, io);
        callback(result);
      } catch (error) {
        callback({ success: false, error: String(error) });
      }
    });

    socket.on("endDebate", async (data: EndDebateRequest, callback) => {
      try {
        const userId = socketUserMap.get(socket.id);
        if (!userId) throw new Error("Not authenticated");
        const authorized = await checkAuthorization(data.roomCode, userId);
        if (!authorized) throw new Error("Not authorized");
        const result = await endDebate(data.roomCode, io);
        callback(result);
      } catch (error) {
        callback({ success: false, error: String(error) });
      }
    });

    socket.on("getDebateState", async (data: GetDebateStateRequest, callback) => {
      try {
        const state = await getOrLoadState(data.roomCode, io);
        callback({ success: true, state });
      } catch (error) {
        callback({ success: false, error: String(error) });
      }
    });

    // ── disconnect ──
    socket.on("disconnect", () => {
      console.log(`Socket disconnected [id:${socket.id}]`);

      const userId = socketUserMap.get(socket.id);

      // Clean up mediasoup peer
      const roomId = socketRoomMap.get(socket.id);
      if (roomId) {
        const room = getRoom(roomId);
        if (room) {
          const peer = removePeerFromRoom(room, socket.id);
          if (peer) {
            socket.to(roomId).emit("peerLeft", {
              peerId: socket.id,
              displayName: peer.displayName,
            });
          }
        }
        socketRoomMap.delete(socket.id);
        socketPeerMap.delete(socket.id);

        // Handle debate speaker disconnect
        if (userId) {
          handleSpeakerDisconnect(roomId, userId, io).catch(console.error);
        }
      }

      // Handle debate room disconnect (for audience-only sockets)
      const debateRoom = socketDebateRoomMap.get(socket.id);
      if (debateRoom && debateRoom !== roomId && userId) {
        handleSpeakerDisconnect(debateRoom, userId, io).catch(console.error);
      }

      socketUserMap.delete(socket.id);
      socketDebateRoomMap.delete(socket.id);
    });
  });
}
