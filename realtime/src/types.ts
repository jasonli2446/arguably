import type {
  Transport,
  Producer,
  Consumer,
  Router,
  RtpCapabilities,
  DtlsParameters,
  RtpParameters,
  MediaKind,
  IceCandidate,
  IceParameters,
} from "mediasoup/types";

// ── Transport direction wrapper ──

export interface TransportInfo {
  transport: Transport;
  direction: "send" | "recv";
}

// ── Peer state machine ──
// connected → grace (on disconnect) → connected (on reconnect) or closed (on timer expiry)

export type PeerState = "connected" | "grace" | "closed";

// ── Peer & Room ──

export interface Peer {
  id: string;
  stablePeerId: string;
  displayName: string;
  state: PeerState;
  transports: Map<string, TransportInfo>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
}

export interface Room {
  id: string;
  router: Router;
  peers: Map<string, Peer>;
}

// ── Client → Server event payloads ──

export interface JoinRequest {
  roomId: string;
  displayName: string;
  rtpCapabilities: RtpCapabilities;
}

export interface CreateTransportRequest {
  direction: "send" | "recv";
}

export interface ConnectTransportRequest {
  transportId: string;
  dtlsParameters: DtlsParameters;
}

export interface ProduceRequest {
  transportId: string;
  kind: MediaKind;
  rtpParameters: RtpParameters;
  appData?: Record<string, unknown>;
}

export interface ConsumeRequest {
  producerId: string;
}

export interface ResumeConsumerRequest {
  consumerId: string;
}

export interface CloseProducerRequest {
  producerId: string;
}

export interface ReconnectRequest {
  roomId: string;
  stablePeerId: string;
  displayName: string;
  rtpCapabilities: RtpCapabilities;
}

// ── Server → Client payloads ──

export interface TransportOptions {
  id: string;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: DtlsParameters;
}

export interface ConsumerData {
  id: string;
  producerId: string;
  kind: MediaKind;
  rtpParameters: RtpParameters;
  peerId: string;
  displayName: string;
}

export interface NewProducerNotification {
  producerId: string;
  peerId: string;
  displayName: string;
  kind: MediaKind;
}

export interface TransportFailureNotification {
  transportId: string;
  direction: "send" | "recv" | "unknown";
  reason: string;
}

export interface PeerReconnectingNotification {
  peerId: string;
  displayName: string;
}

export interface PeerReconnectedNotification {
  peerId: string;
  displayName: string;
}

// ── Generic acknowledgement wrapper ──

export interface AckResponse {
  success: boolean;
  [key: string]: unknown;
}
