import { randomUUID } from "node:crypto";
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
import { createLogger } from "./logger.js";
import { getOrCreateRoom, addPeerToRoom, removePeerFromRoom, getRoom } from "./mediasoup/rooms.js";

const log = createLogger("signaling");
import { createWebRtcTransport, getTransportOptions } from "./mediasoup/transports.js";
import { createProducer } from "./mediasoup/producers.js";
import { createConsumer } from "./mediasoup/consumers.js";
import type { RtpCapabilities } from "mediasoup/types";
import { schemas, validatePayload } from "./validation.js";
import { getSessionByCode, markParticipantLeft, removeFromAudienceQueue } from "./db.js";
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
    log.info({ socketId: socket.id }, "Socket connected");

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
        log.error({ socketId: socket.id, error: String(error) }, "getRouterRtpCapabilities error");
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

        // If same user already has a peer in this room (e.g. hard refresh),
        // clean up the old one to avoid duplicate streams
        if (authUserId) {
          for (const [oldSocketId, existingPeer] of room.peers) {
            if (existingPeer.userId === authUserId && oldSocketId !== socket.id) {
              // Close old producers and notify others
              for (const [producerId, producer] of existingPeer.producers) {
                producer.close();
                io.to(roomId).emit("producerClosed", { producerId });
              }
              // Cancel grace timer if active
              const oldStablePeerId = existingPeer.stablePeerId;
              const graceEntry = gracePeriodTimers.get(oldStablePeerId);
              if (graceEntry) {
                clearTimeout(graceEntry.timer);
                gracePeriodTimers.delete(oldStablePeerId);
              }
              removePeerFromRoom(room, oldSocketId);
              socketRoomMap.delete(oldSocketId);
              socketPeerMap.delete(oldSocketId);
              socketToPeerId.delete(oldSocketId);
              socketUserMap.delete(oldSocketId);
              socketDebateRoomMap.delete(oldSocketId);
              io.to(roomId).emit("peerLeft", {
                peerId: oldSocketId,
                displayName: existingPeer.displayName,
              });
              log.info({}, `Evicted stale peer for same user [userId:${authUserId}, oldSocket:${oldSocketId}]`);
              break;
            }
          }
        }

        const stablePeerId = randomUUID();

        const peer: Peer = {
          id: socket.id,
          stablePeerId,
          displayName,
          userId: authUserId,
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
        log.error({ socketId: socket.id, error: String(error) }, "joinRoom error");
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
          log.info({}, `Reconnection within grace period [stablePeerId:${stablePeerId}]`);
        }

        // Close old producers and notify other clients so they remove stale streams
        for (const [producerId, producer] of oldPeer.producers) {
          producer.close();
          socket.to(roomId).emit("producerClosed", { producerId });
        }
        oldPeer.producers.clear();

        // Close old transports (consumers + transports)
        for (const { transport } of oldPeer.transports.values()) {
          transport.close();
        }
        oldPeer.transports.clear();
        oldPeer.consumers.clear();

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
        log.error({ socketId: socket.id, error: String(error) }, "reconnect error");
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
          log.info({}, `Transport [id:${transport.id}, direction:${parsed.data.direction}] dtls state: ${dtlsState}`);

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
        log.error({ socketId: socket.id, error: String(error) }, "createWebRtcTransport error");
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
        log.error({ socketId: socket.id, error: String(error) }, "connectTransport error");
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
            log.info({ score }, `Producer [id:${producer.id}, kind:${producer.kind}] score`);
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
        log.error({ socketId: socket.id, error: String(error) }, "produce error");
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
            log.info({ score }, `Consumer [id:${consumer.id}, kind:${consumer.kind}] score`);
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
        log.error({ socketId: socket.id, error: String(error) }, "consume error");
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
        log.error({ socketId: socket.id, error: String(error) }, "resumeConsumer error");
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
        log.error({ socketId: socket.id, error: String(error) }, "closeProducer error");
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
        log.error({ socketId: socket.id, error: String(error) }, "getProducers error");
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

    // ── MODERATION BROADCASTS ──

    socket.on("moderatorKick", async (data: { roomCode: string; userId: string }, callback) => {
      try {
        const callerId = socketUserMap.get(socket.id)
        if (!callerId) return callback({ success: false, error: "Not authenticated" })
        const authorized = await checkAuthorization(data.roomCode, callerId)
        if (!authorized) return callback({ success: false, error: "Not authorized" })
        io.to(data.roomCode).emit("participantKicked", { userId: data.userId })
        callback({ success: true })
      } catch (error) {
        callback({ success: false, error: String(error) })
      }
    })

    socket.on("moderatorPromote", async (data: { roomCode: string; userId: string }, callback) => {
      try {
        const callerId = socketUserMap.get(socket.id)
        if (!callerId) return callback({ success: false, error: "Not authenticated" })
        const authorized = await checkAuthorization(data.roomCode, callerId)
        if (!authorized) return callback({ success: false, error: "Not authorized" })
        io.to(data.roomCode).emit("participantPromoted", { userId: data.userId })
        callback({ success: true })
      } catch (error) {
        callback({ success: false, error: String(error) })
      }
    })

    socket.on("moderatorMute", async (data: { roomCode: string; targetUserId: string }, callback) => {
      try {
        const callerId = socketUserMap.get(socket.id)
        if (!callerId) return callback({ success: false, error: "Not authenticated" })
        const authorized = await checkAuthorization(data.roomCode, callerId)
        if (!authorized) return callback({ success: false, error: "Not authorized" })

        // Find target socket by userId and pause their audio producers
        for (const [targetSocketId, userId] of socketUserMap.entries()) {
          if (userId !== data.targetUserId) continue
          const targetRoomId = socketRoomMap.get(targetSocketId)
          const room = targetRoomId ? getRoom(targetRoomId) : undefined
          if (room) {
            const targetPeer = room.peers.get(targetSocketId)
            if (targetPeer) {
              for (const [, producer] of targetPeer.producers) {
                if (producer.kind === "audio" && !producer.closed) await producer.pause()
              }
            }
          }
          io.to(targetSocketId).emit("forceMuted", { userId: data.targetUserId })
          break
        }

        io.to(data.roomCode).emit("participantMuted", { userId: data.targetUserId })
        callback({ success: true })
      } catch (error) {
        callback({ success: false, error: String(error) })
      }
    })

    // ── disconnect ──
    socket.on("disconnect", () => {
      log.info({}, `Socket disconnected [id:${socket.id}]`);

      const roomId = socketRoomMap.get(socket.id);
      const stablePeerId = socketToPeerId.get(socket.id);

      if (!roomId || !stablePeerId) {
        // No room/peer state — immediate cleanup
        socketRoomMap.delete(socket.id);
        socketPeerMap.delete(socket.id);
        socketToPeerId.delete(socket.id);
        socketUserMap.delete(socket.id);
        socketDebateRoomMap.delete(socket.id);
        return;
      }

      const room = getRoom(roomId);
      if (!room) {
        socketRoomMap.delete(socket.id);
        socketPeerMap.delete(socket.id);
        socketToPeerId.delete(socket.id);
        socketUserMap.delete(socket.id);
        socketDebateRoomMap.delete(socket.id);
        return;
      }

      const peer = room.peers.get(socket.id);
      if (!peer) {
        socketRoomMap.delete(socket.id);
        socketPeerMap.delete(socket.id);
        socketToPeerId.delete(socket.id);
        socketUserMap.delete(socket.id);
        socketDebateRoomMap.delete(socket.id);
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
      const timer = setTimeout(async () => {
        log.info({}, `Grace period expired [stablePeerId:${stablePeerId}]`);
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

        // DB cleanup — mark participant as left (idempotent if sendBeacon already ran)
        const userId = socketUserMap.get(socket.id);
        if (userId) {
          try {
            const session = await getSessionByCode(roomId);
            if (session) {
              await markParticipantLeft(session.id, userId);
              await removeFromAudienceQueue(session.id, userId);
            }
          } catch (err) {
            log.error({ socketId: socket.id, error: String(err) }, "DB cleanup after grace period failed");
          }

          // Advance debate turn if this was the current speaker
          try {
            await handleSpeakerDisconnect(roomId, userId, io);
          } catch (err) {
            log.error({ socketId: socket.id, error: String(err) }, "handleSpeakerDisconnect failed");
          }
        }

        socketRoomMap.delete(socket.id);
        socketPeerMap.delete(socket.id);
        socketToPeerId.delete(socket.id);
        socketUserMap.delete(socket.id);
        socketDebateRoomMap.delete(socket.id);
      }, RECONNECT_GRACE_MS);

      gracePeriodTimers.set(stablePeerId, {
        timer,
        oldSocketId: socket.id,
        roomId,
        displayName: peer.displayName,
        rtpCapabilities: peerData?.rtpCapabilities || { codecs: [] },
      });

      log.info({}, `Grace period started [stablePeerId:${stablePeerId}, duration:${RECONNECT_GRACE_MS}ms]`);
    });
  });
}
