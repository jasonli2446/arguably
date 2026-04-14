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
  userId?: string;
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

// ── Debate types ──

export type DebateFormat = "ONE_ON_ONE" | "EXPERT_VS_CROWD" | "TEAM" | "PANEL";
export type DebatePhase = "ACTIVE" | "GRACE" | "PAUSED" | "ENDED";
export type TurnReason =
  | "TIMER_EXPIRED"
  | "MANUAL_ADVANCE"
  | "SPEAKER_DISCONNECT"
  | "DEBATE_START";

export interface DebateParticipant {
  userId: string;
  displayName: string;
}

// Client → Server debate events

export interface JoinDebateRoomRequest {
  roomCode: string;
}

export interface StartDebateRequest {
  roomCode: string;
  debaters: DebateParticipant[];
  turnLength: number;
  format: DebateFormat;
  formatMeta?: Record<string, unknown>;
}

export interface NextTurnRequest {
  roomCode: string;
  version: number;
}

export interface PauseDebateRequest {
  roomCode: string;
}

export interface ResumeDebateRequest {
  roomCode: string;
}

export interface EndDebateRequest {
  roomCode: string;
}

export interface GetDebateStateRequest {
  roomCode: string;
}

// Server → Client debate events

export interface TurnChangedPayload {
  version: number;
  currentIndex: number;
  debaterOrder: DebateParticipant[];
  turnStartedAt: number;
  turnLength: number;
  phase: DebatePhase;
}

export interface TurnExpiringPayload {
  version: number;
  expiredUserId: string;
}

export interface TurnWarningPayload {
  secondsRemaining: number;
}

export interface DebatePausedPayload {
  version: number;
  timeRemaining: number;
}

export interface DebateResumedPayload {
  version: number;
  turnStartedAt: number;
  turnLength: number;
}

export interface DebateEndedPayload {
  version: number;
}

export interface ForceMutePayload {
  userId: string;
}

export interface ForceUnmutePayload {
  userId: string;
}

export interface DebateStatePayload {
  version: number;
  debaterOrder: DebateParticipant[];
  currentIndex: number;
  turnLength: number;
  turnStartedAt: number | null;
  isPaused: boolean;
  pausedTimeRemaining: number;
  format: DebateFormat;
  formatMeta: Record<string, unknown> | null;
  phase: DebatePhase;
}

