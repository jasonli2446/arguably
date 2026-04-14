import { randomUUID } from "node:crypto";
import type { Server as SocketIOServer, Socket } from "socket.io";
import type {
  Peer,
  JoinRequest,
  CreateTransportRequest,
  ConnectTransportRequest,
  ProduceRequest,
  ConsumeRequest,
  ResumeConsumerRequest,
  CloseProducerRequest,
  ReconnectRequest,
} from "./types.js";
import { iceServers } from "./config.js";
import {
  getOrCreateRoom,
  addPeerToRoom,
  removePeerFromRoom,
  getRoom,
  deleteRoom,
} from "./mediasoup/rooms.js";
import { createWebRtcTransport, getTransportOptions } from "./mediasoup/transports.js";
import { createProducer } from "./mediasoup/producers.js";
import { createConsumer } from "./mediasoup/consumers.js";
import type { RtpCapabilities } from "mediasoup/types";

// ── Socket tracking ──
const socketRoomMap = new Map<string, string>();
const socketPeerMap = new Map<string, { rtpCapabilities: RtpCapabilities }>();

// ── Reconnection state ──
const RECONNECT_GRACE_MS = 30_000;
const socketToPeerId = new Map<string, string>(); // socket.id → stablePeerId
const gracePeriodTimers = new Map<
  string,
  {
    timer: ReturnType<typeof setTimeout>;
    oldSocketId: string;
    roomId: string;
    displayName: string;
    rtpCapabilities: RtpCapabilities;
  }
>(); // stablePeerId → grace data

// ── Quality monitoring: throttle score logs ──
const lastScoreLog = new Map<string, number>(); // producerId/consumerId → timestamp
const SCORE_LOG_INTERVAL_MS = 10_000;

/** Exported for health endpoint */
export function getGracePeriodCount(): number {
  return gracePeriodTimers.size;
}

/** Collect active producers from a room (excluding a given socket) */
function collectRoomProducers(
  room: ReturnType<typeof getRoom>,
  excludeSocketId: string,
): Array<{ producerId: string; peerId: string; displayName: string; kind: string }> {
  if (!room) return [];
  const producers: Array<{
    producerId: string;
    peerId: string;
    displayName: string;
    kind: string;
  }> = [];

  for (const [, peer] of room.peers) {
    if (peer.id === excludeSocketId) continue;
    if (peer.state !== "connected") continue;
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
    socket.on("getRouterRtpCapabilities", async (data: { roomId: string }, callback) => {
      try {
        const room = await getOrCreateRoom(data.roomId);
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
    socket.on("joinRoom", async (data: JoinRequest, callback) => {
      try {
        const room = await getOrCreateRoom(data.roomId);

        const stablePeerId = randomUUID();
        const peer: Peer = {
          id: socket.id,
          stablePeerId,
          displayName: data.displayName,
          state: "connected",
          transports: new Map(),
          producers: new Map(),
          consumers: new Map(),
        };

        addPeerToRoom(room, peer);
        socketRoomMap.set(socket.id, data.roomId);
        socketPeerMap.set(socket.id, { rtpCapabilities: data.rtpCapabilities });
        socketToPeerId.set(socket.id, stablePeerId);

        // Join socket.io room for broadcasting
        socket.join(data.roomId);

        // Notify other peers
        socket.to(data.roomId).emit("peerJoined", {
          peerId: socket.id,
          displayName: data.displayName,
        });

        // Return list of existing connected peers
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
    socket.on("reconnect", async (data: ReconnectRequest, callback) => {
      try {
        const { roomId, stablePeerId, displayName, rtpCapabilities } = data;

        // Validate grace period exists for this peerId
        const graceData = gracePeriodTimers.get(stablePeerId);
        if (!graceData) {
          callback({ success: false, error: "No active grace period. Please rejoin." });
          return;
        }

        // Validate room matches
        if (graceData.roomId !== roomId) {
          callback({ success: false, error: "Room mismatch." });
          return;
        }

        const room = getRoom(roomId);
        if (!room) {
          gracePeriodTimers.delete(stablePeerId);
          clearTimeout(graceData.timer);
          callback({ success: false, error: "Room no longer exists." });
          return;
        }

        // Cancel grace period timer
        clearTimeout(graceData.timer);
        gracePeriodTimers.delete(stablePeerId);

        // Find the old peer entry and re-key it under the new socket.id
        const oldPeer = room.peers.get(graceData.oldSocketId);
        if (!oldPeer) {
          callback({ success: false, error: "Peer state lost. Please rejoin." });
          return;
        }

        // Re-key peer under new socket
        room.peers.delete(graceData.oldSocketId);
        oldPeer.id = socket.id;
        oldPeer.displayName = displayName;
        oldPeer.state = "connected";
        oldPeer.transports = new Map();
        oldPeer.producers = new Map();
        oldPeer.consumers = new Map();
        room.peers.set(socket.id, oldPeer);

        // Update tracking maps
        socketRoomMap.set(socket.id, roomId);
        socketPeerMap.set(socket.id, { rtpCapabilities });
        socketToPeerId.set(socket.id, stablePeerId);

        // Join socket.io room for broadcasts
        socket.join(roomId);

        // Broadcast reconnected to room
        socket.to(roomId).emit("peerReconnected", {
          peerId: socket.id,
          displayName,
        });

        console.log(`Peer reconnected [room:${roomId}, peer:${socket.id}, name:${displayName}]`);

        // Return existing connected peers and their active producers
        const existingPeers = Array.from(room.peers.values())
          .filter((p) => p.id !== socket.id && p.state === "connected")
          .map((p) => ({ peerId: p.id, displayName: p.displayName }));

        const producers = collectRoomProducers(room, socket.id);

        callback({ success: true, peers: existingPeers, producers });
      } catch (error) {
        console.error("reconnect error:", error);
        callback({ success: false, error: String(error) });
      }
    });

    // ── createWebRtcTransport ──
    socket.on("createWebRtcTransport", async (data: CreateTransportRequest, callback) => {
      try {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) throw new Error("Not in a room");

        const room = getRoom(roomId);
        if (!room) throw new Error("Room not found");

        const peer = room.peers.get(socket.id);
        if (!peer) throw new Error("Peer not found");

        const transport = await createWebRtcTransport(room.router);

        // ── DTLS failure handling (AC 4, 5) ──
        transport.on("dtlsstatechange", (dtlsState: string) => {
          console.log(
            `Transport DTLS state change [transport:${transport.id}, peer:${socket.id}, state:${dtlsState}]`,
          );

          if (dtlsState === "closed" || dtlsState === "failed") {
            const direction = peer.transports.get(transport.id)?.direction ?? "unknown";

            // Close the transport (cascades to producers/consumers on it)
            transport.close();

            // Remove from peer's transport map
            peer.transports.delete(transport.id);

            // Clean up closed producers and notify room
            for (const [producerId, producer] of peer.producers) {
              if (producer.closed) {
                peer.producers.delete(producerId);
                socket.to(roomId).emit("producerClosed", { producerId });
              }
            }

            // Clean up closed consumers
            for (const [consumerId, consumer] of peer.consumers) {
              if (consumer.closed) {
                peer.consumers.delete(consumerId);
              }
            }

            // Notify the client about the transport failure
            socket.emit("transportFailure", {
              transportId: transport.id,
              direction,
              reason: `DTLS state: ${dtlsState}`,
            });
          }
        });

        peer.transports.set(transport.id, { transport, direction: data.direction });

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
    socket.on("connectTransport", async (data: ConnectTransportRequest, callback) => {
      try {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) throw new Error("Not in a room");

        const room = getRoom(roomId);
        if (!room) throw new Error("Room not found");

        const peer = room.peers.get(socket.id);
        if (!peer) throw new Error("Peer not found");

        const transportInfo = peer.transports.get(data.transportId);
        if (!transportInfo) throw new Error("Transport not found");

        await transportInfo.transport.connect({ dtlsParameters: data.dtlsParameters });

        callback({ success: true });
      } catch (error) {
        console.error("connectTransport error:", error);
        callback({ success: false, error: String(error) });
      }
    });

    // ── produce ──
    socket.on("produce", async (data: ProduceRequest, callback) => {
      try {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) throw new Error("Not in a room");

        const room = getRoom(roomId);
        if (!room) throw new Error("Room not found");

        const peer = room.peers.get(socket.id);
        if (!peer) throw new Error("Peer not found");

        const transportInfo = peer.transports.get(data.transportId);
        if (!transportInfo) throw new Error("Transport not found");

        const producer = await createProducer(
          transportInfo.transport,
          data.kind,
          data.rtpParameters,
          data.appData,
        );

        peer.producers.set(producer.id, producer);

        producer.on("transportclose", () => {
          peer.producers.delete(producer.id);
        });

        // Quality monitoring: throttled score logging (AC 7)
        producer.on("score", (score) => {
          const now = Date.now();
          const lastLog = lastScoreLog.get(producer.id) ?? 0;
          if (now - lastLog >= SCORE_LOG_INTERVAL_MS) {
            lastScoreLog.set(producer.id, now);
            const minScore = Math.min(...score.map((s) => s.score));
            console.log(
              `Producer score [producer:${producer.id}, peer:${socket.id}, kind:${producer.kind}, minScore:${minScore}]`,
            );
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
    socket.on("consume", async (data: ConsumeRequest, callback) => {
      try {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) throw new Error("Not in a room");

        const room = getRoom(roomId);
        if (!room) throw new Error("Room not found");

        const peer = room.peers.get(socket.id);
        if (!peer) throw new Error("Peer not found");

        const peerData = socketPeerMap.get(socket.id);
        if (!peerData) throw new Error("Peer RTP capabilities not found");

        // Find recv transport by direction tag (AC 6)
        const recvTransportInfo = Array.from(peer.transports.values()).find(
          (info) => info.direction === "recv",
        );
        if (!recvTransportInfo) throw new Error("Recv transport not found");

        // Find the producer's peer for display name (AC 8: throw if not found)
        let producerPeerId = "";
        let producerDisplayName = "";
        let found = false;
        for (const [, roomPeer] of room.peers) {
          if (roomPeer.producers.has(data.producerId)) {
            producerPeerId = roomPeer.id;
            producerDisplayName = roomPeer.displayName;
            found = true;
            break;
          }
        }
        if (!found) {
          throw new Error(`Producer ${data.producerId} not found in any peer`);
        }

        const consumer = await createConsumer(
          room.router,
          recvTransportInfo.transport,
          data.producerId,
          peerData.rtpCapabilities,
        );

        peer.consumers.set(consumer.id, consumer);

        consumer.on("transportclose", () => {
          peer.consumers.delete(consumer.id);
        });

        consumer.on("producerclose", () => {
          peer.consumers.delete(consumer.id);
          socket.emit("producerClosed", { producerId: data.producerId });
        });

        // Quality monitoring: throttled score logging (AC 7)
        consumer.on("score", (score) => {
          const now = Date.now();
          const lastLog = lastScoreLog.get(consumer.id) ?? 0;
          if (now - lastLog >= SCORE_LOG_INTERVAL_MS) {
            lastScoreLog.set(consumer.id, now);
            console.log(
              `Consumer score [consumer:${consumer.id}, peer:${socket.id}, score:${score.score}, producerScore:${score.producerScore}]`,
            );
          }
        });

        callback({
          success: true,
          id: consumer.id,
          producerId: data.producerId,
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
    socket.on("resumeConsumer", async (data: ResumeConsumerRequest, callback) => {
      try {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) throw new Error("Not in a room");

        const room = getRoom(roomId);
        if (!room) throw new Error("Room not found");

        const peer = room.peers.get(socket.id);
        if (!peer) throw new Error("Peer not found");

        const consumer = peer.consumers.get(data.consumerId);
        if (!consumer) throw new Error("Consumer not found");

        await consumer.resume();
        callback({ success: true });
      } catch (error) {
        console.error("resumeConsumer error:", error);
        callback({ success: false, error: String(error) });
      }
    });

    // ── closeProducer ──
    socket.on("closeProducer", async (data: CloseProducerRequest, callback) => {
      try {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) throw new Error("Not in a room");

        const room = getRoom(roomId);
        if (!room) throw new Error("Room not found");

        const peer = room.peers.get(socket.id);
        if (!peer) throw new Error("Peer not found");

        const producer = peer.producers.get(data.producerId);
        if (!producer) throw new Error("Producer not found");

        producer.close();
        peer.producers.delete(data.producerId);

        // Notify other peers
        socket.to(roomId).emit("producerClosed", {
          producerId: data.producerId,
        });

        callback({ success: true });
      } catch (error) {
        console.error("closeProducer error:", error);
        callback({ success: false, error: String(error) });
      }
    });

    // ── getProducers ──
    socket.on("getProducers", async (_data: unknown, callback) => {
      try {
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

      if (!roomId) {
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
      if (!peer || !stablePeerId) {
        // Unknown peer — immediate cleanup
        removePeerFromRoom(room, socket.id);
        socketRoomMap.delete(socket.id);
        socketPeerMap.delete(socket.id);
        socketToPeerId.delete(socket.id);
        return;
      }

      // ── Grace period: session continuity with fast rejoin (AC 1, 2, 3) ──
      peer.state = "grace";

      // Broadcast "reconnecting" to room (use io.to since socket is disconnecting)
      io.to(roomId).emit("peerReconnecting", {
        peerId: socket.id,
        displayName: peer.displayName,
      });

      // Close dead transports (ICE/DTLS is non-recoverable)
      for (const { transport } of peer.transports.values()) {
        transport.close();
      }
      peer.transports.clear();
      peer.producers.clear();
      peer.consumers.clear();

      // Save RTP capabilities for potential reconnection
      const peerData = socketPeerMap.get(socket.id);

      // Clean up socket-level maps for old socket
      socketRoomMap.delete(socket.id);
      socketPeerMap.delete(socket.id);
      socketToPeerId.delete(socket.id);

      // Start grace period timer
      const timer = setTimeout(() => {
        console.log(
          `Grace period expired [stablePeerId:${stablePeerId}, room:${roomId}]`,
        );
        gracePeriodTimers.delete(stablePeerId);

        const currentRoom = getRoom(roomId);
        if (!currentRoom) return;

        const stalePeer = currentRoom.peers.get(socket.id);
        if (stalePeer) {
          stalePeer.state = "closed";
          currentRoom.peers.delete(socket.id);

          io.to(roomId).emit("peerLeft", {
            peerId: socket.id,
            displayName: stalePeer.displayName,
          });

          // Auto-close room only if no peers in any state remain
          const hasAnyPeers = currentRoom.peers.size > 0 ||
            Array.from(gracePeriodTimers.values()).some((g) => g.roomId === roomId);
          if (!hasAnyPeers) {
            deleteRoom(roomId);
          }
        }
      }, RECONNECT_GRACE_MS);

      gracePeriodTimers.set(stablePeerId, {
        timer,
        oldSocketId: socket.id,
        roomId,
        displayName: peer.displayName,
        rtpCapabilities: peerData?.rtpCapabilities ?? ({} as RtpCapabilities),
      });

      console.log(
        `Grace period started [stablePeerId:${stablePeerId}, room:${roomId}, timeout:${RECONNECT_GRACE_MS}ms]`,
      );
    });
  });
}
