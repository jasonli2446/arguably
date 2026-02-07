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

// ── Peer & Room ──

export interface Peer {
  id: string;
  displayName: string;
  transports: Map<string, Transport>;
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

// ── Generic acknowledgement wrapper ──

export interface AckResponse {
  success: boolean;
  [key: string]: unknown;
}
