import "dotenv/config";
import os from "node:os";
import type {
  WorkerSettings,
  RouterOptions,
  WebRtcTransportOptions,
} from "mediasoup/types";

// ── Environment with defaults ──

const ANNOUNCED_IP = process.env.ANNOUNCED_IP || "127.0.0.1";
const LISTEN_PORT = parseInt(process.env.LISTEN_PORT || "3001", 10);
const NUM_WORKERS = parseInt(
  process.env.MEDIASOUP_NUM_WORKERS || String(Math.min(os.cpus().length, 4)),
  10,
);
const RTC_MIN_PORT = parseInt(process.env.RTC_MIN_PORT || "40000", 10);
const RTC_MAX_PORT = parseInt(process.env.RTC_MAX_PORT || "40100", 10);

const TURN_HOST = process.env.TURN_HOST || ANNOUNCED_IP;
const TURN_PORT = parseInt(process.env.TURN_PORT || "3478", 10);
const TURN_USERNAME = process.env.TURN_USERNAME || "arguably";
const TURN_PASSWORD = process.env.TURN_PASSWORD || "arguably-turn-password";

// ── mediasoup worker settings ──

export const workerSettings: WorkerSettings = {
  logLevel: "warn",
  rtcMinPort: RTC_MIN_PORT,
  rtcMaxPort: RTC_MAX_PORT,
};

// ── Router codecs ──

export const routerOptions: RouterOptions = {
  mediaCodecs: [
    {
      kind: "audio",
      mimeType: "audio/opus",
      clockRate: 48000,
      channels: 2,
    },
    {
      kind: "video",
      mimeType: "video/VP8",
      clockRate: 90000,
      parameters: {},
    },
    {
      kind: "video",
      mimeType: "video/VP9",
      clockRate: 90000,
      parameters: {
        "profile-id": 2,
      },
    },
    {
      kind: "video",
      mimeType: "video/H264",
      clockRate: 90000,
      parameters: {
        "level-asymmetry-allowed": 1,
        "packetization-mode": 1,
        "profile-level-id": "42e01f",
      },
    },
  ],
};

// ── WebRTC transport options ──

export const webRtcTransportOptions: WebRtcTransportOptions = {
  listenInfos: [
    { protocol: "udp", ip: "0.0.0.0", announcedAddress: ANNOUNCED_IP },
    { protocol: "tcp", ip: "0.0.0.0", announcedAddress: ANNOUNCED_IP },
  ],
  initialAvailableOutgoingBitrate: 1_000_000,
  enableUdp: true,
  enableTcp: true,
  preferUdp: true,
};

// ── ICE servers (sent to clients) ──

export const iceServers = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: `turn:${TURN_HOST}:${TURN_PORT}`,
    username: TURN_USERNAME,
    credential: TURN_PASSWORD,
  },
];

// ── Exports ──

export { ANNOUNCED_IP, LISTEN_PORT, NUM_WORKERS };
