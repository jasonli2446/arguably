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
} from "./types.js";
import { iceServers } from "./config.js";
import { getOrCreateRoom, addPeerToRoom, removePeerFromRoom, getRoom } from "./mediasoup/rooms.js";
import { createWebRtcTransport, getTransportOptions } from "./mediasoup/transports.js";
import { createProducer } from "./mediasoup/producers.js";
import { createConsumer } from "./mediasoup/consumers.js";
import type { RtpCapabilities } from "mediasoup/types";

// Track which room each socket is in
const socketRoomMap = new Map<string, string>();
const socketPeerMap = new Map<string, { rtpCapabilities: RtpCapabilities }>();

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

        const peer: Peer = {
          id: socket.id,
          displayName: data.displayName,
          transports: new Map(),
          producers: new Map(),
          consumers: new Map(),
        };

        addPeerToRoom(room, peer);
        socketRoomMap.set(socket.id, data.roomId);
        socketPeerMap.set(socket.id, { rtpCapabilities: data.rtpCapabilities });

        // Join socket.io room for broadcasting
        socket.join(data.roomId);

        // Notify other peers
        socket.to(data.roomId).emit("peerJoined", {
          peerId: socket.id,
          displayName: data.displayName,
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
    socket.on("createWebRtcTransport", async (data: CreateTransportRequest, callback) => {
      try {
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
    socket.on("connectTransport", async (data: ConnectTransportRequest, callback) => {
      try {
        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) throw new Error("Not in a room");

        const room = getRoom(roomId);
        if (!room) throw new Error("Room not found");

        const peer = room.peers.get(socket.id);
        if (!peer) throw new Error("Peer not found");

        const transport = peer.transports.get(data.transportId);
        if (!transport) throw new Error("Transport not found");

        await transport.connect({ dtlsParameters: data.dtlsParameters });

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

        const transport = peer.transports.get(data.transportId);
        if (!transport) throw new Error("Transport not found");

        const producer = await createProducer(
          transport,
          data.kind,
          data.rtpParameters,
          data.appData,
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

        // Use the last transport (recv transport is created second)
        const transports = Array.from(peer.transports.values());
        const transport = transports[transports.length - 1];
        if (!transport) throw new Error("Recv transport not found");

        // Find the producer's peer for display name
        let producerPeerId = "";
        let producerDisplayName = "";
        for (const [, roomPeer] of room.peers) {
          if (roomPeer.producers.has(data.producerId)) {
            producerPeerId = roomPeer.id;
            producerDisplayName = roomPeer.displayName;
            break;
          }
        }

        const consumer = await createConsumer(
          room.router,
          transport,
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

    // ── disconnect ──
    socket.on("disconnect", () => {
      console.log(`Socket disconnected [id:${socket.id}]`);

      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;

      const room = getRoom(roomId);
      if (!room) return;

      const peer = removePeerFromRoom(room, socket.id);
      socketRoomMap.delete(socket.id);
      socketPeerMap.delete(socket.id);

      if (peer) {
        socket.to(roomId).emit("peerLeft", {
          peerId: socket.id,
          displayName: peer.displayName,
        });
      }
    });
  });
}
