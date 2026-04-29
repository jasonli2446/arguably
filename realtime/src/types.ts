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

/** Mediasoup transport plus its send/receive direction inside a peer. */
export interface TransportInfo {
  transport: Transport;
  direction: "send" | "recv";
}

/** Lifecycle state for a peer socket in a room. */
export type PeerState = "connected" | "grace" | "closed";

/** In-memory representation of one connected mediasoup peer. */
export interface Peer {
  id: string;
  stablePeerId: string;
  displayName: string;
  userId?: string;
  state: PeerState;
  transports: Map<string, TransportInfo>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
}

/** In-memory mediasoup room with router and peer registry. */
export interface Room {
  id: string;
  router: Router;
  peers: Map<string, Peer>;
}

// ── Client → Server event payloads ──

/** Payload for joining a media room with client RTP capabilities. */
export interface JoinRequest {
  roomId: string;
  displayName: string;
  rtpCapabilities: RtpCapabilities;
}

/** Payload for creating a send or receive WebRTC transport. */
export interface CreateTransportRequest {
  direction: "send" | "recv";
}

/** Payload for connecting a WebRTC transport with DTLS parameters. */
export interface ConnectTransportRequest {
  transportId: string;
  dtlsParameters: DtlsParameters;
}

/** Payload for producing an audio or video track through a transport. */
export interface ProduceRequest {
  transportId: string;
  kind: MediaKind;
  rtpParameters: RtpParameters;
  appData?: Record<string, unknown>;
}

/** Payload for consuming a producer from another peer. */
export interface ConsumeRequest {
  producerId: string;
}

/** Payload for resuming a paused consumer after client setup completes. */
export interface ResumeConsumerRequest {
  consumerId: string;
}

/** Payload for closing a local producer. */
export interface CloseProducerRequest {
  producerId: string;
}

// ── Reconnection payloads ──

/** Payload for replacing a disconnected socket during the reconnection grace period. */
export interface ReconnectRequest {
  roomId: string;
  stablePeerId: string;
  displayName: string;
  rtpCapabilities: RtpCapabilities;
}

/** Notification emitted when a transport enters a failed or closed state. */
export interface TransportFailureNotification {
  transportId: string;
  direction: "send" | "recv" | "unknown";
  reason: string;
}

/** Notification that a peer entered reconnection grace. */
export interface PeerReconnectingNotification {
  peerId: string;
  displayName: string;
}

/** Notification that a peer completed reconnection. */
export interface PeerReconnectedNotification {
  peerId: string;
  displayName: string;
}

// ── Server → Client payloads ──

/** Serializable transport parameters sent to clients. */
export interface TransportOptions {
  id: string;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: DtlsParameters;
}

/** Consumer setup data returned to a receiving client. */
export interface ConsumerData {
  id: string;
  producerId: string;
  kind: MediaKind;
  rtpParameters: RtpParameters;
  peerId: string;
  displayName: string;
}

/** Notification emitted when a peer creates a new media producer. */
export interface NewProducerNotification {
  producerId: string;
  peerId: string;
  displayName: string;
  kind: MediaKind;
}

// ── Generic acknowledgement wrapper ──

/** Socket acknowledgement envelope used by realtime handlers. */
export interface AckResponse {
  success: boolean;
  [key: string]: unknown;
}

// ── Debate types ──

/** Debate formats supported by the realtime turn engine. */
export type DebateFormat = "ONE_ON_ONE" | "EXPERT_VS_CROWD" | "TEAM" | "PANEL";
/** Runtime phase of a realtime debate. */
export type DebatePhase = "ACTIVE" | "GRACE" | "PAUSED" | "ENDED";
/** Reason recorded when a turn transition is logged. */
export type TurnReason =
  | "TIMER_EXPIRED"
  | "MANUAL_ADVANCE"
  | "SPEAKER_DISCONNECT"
  | "DEBATE_START";

/** Minimal participant identity used in realtime turn order. */
export interface DebateParticipant {
  userId: string;
  displayName: string;
}

/** Payload for joining a lightweight debate room without media setup. */
export interface JoinDebateRoomRequest { roomCode: string; }
/** Payload for starting a debate and seeding turn order. */
export interface StartDebateRequest { roomCode: string; debaters: DebateParticipant[]; turnLength: number; format: DebateFormat; formatMeta?: Record<string, unknown>; }
/** Payload for manually advancing the current turn. */
export interface NextTurnRequest { roomCode: string; version: number; }
/** Payload for pausing a debate. */
export interface PauseDebateRequest { roomCode: string; }
/** Payload for resuming a debate. */
export interface ResumeDebateRequest { roomCode: string; }
/** Payload for ending a debate. */
export interface EndDebateRequest { roomCode: string; }
/** Payload for requesting current realtime debate state. */
export interface GetDebateStateRequest { roomCode: string; }
/** Payload for extending the current or paused turn. */
export interface ExtendTurnRequest { roomCode: string; extraSeconds: number; }

/** Broadcast payload when the active speaker changes. */
export interface TurnChangedPayload { version: number; currentIndex: number; debaterOrder: DebateParticipant[]; turnStartedAt: number; turnLength: number; phase: DebatePhase; }
/** Broadcast payload when a speaker enters the post-turn grace period. */
export interface TurnExpiringPayload { version: number; expiredUserId: string; }
/** Broadcast payload for near-expiry timer warnings. */
export interface TurnWarningPayload { secondsRemaining: number; }
/** Broadcast payload when a debate is paused. */
export interface DebatePausedPayload { version: number; timeRemaining: number; }
/** Broadcast payload when a debate resumes. */
export interface DebateResumedPayload { version: number; turnStartedAt: number; turnLength: number; }
/** Broadcast payload when a debate ends. */
export interface DebateEndedPayload { version: number; }
/** Payload that forces one user's audio muted. */
export interface ForceMutePayload { userId: string; }
/** Payload that force-restores one user's audio. */
export interface ForceUnmutePayload { userId: string; }
/** Snapshot of realtime debate state for reconnects and page refreshes. */
export interface DebateStatePayload { version: number; debaterOrder: DebateParticipant[]; currentIndex: number; turnLength: number; turnStartedAt: number | null; isPaused: boolean; pausedTimeRemaining: number; format: DebateFormat; formatMeta: Record<string, unknown> | null; phase: DebatePhase; }

