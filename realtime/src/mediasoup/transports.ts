import type { Router, WebRtcTransport } from "mediasoup/types";
import type { TransportOptions } from "../types.js";
import { webRtcTransportOptions } from "../config.js";

/** Creates a mediasoup WebRTC transport from the shared transport config. */
export async function createWebRtcTransport(
  router: Router,
): Promise<WebRtcTransport> {
  const transport = await router.createWebRtcTransport(webRtcTransportOptions);
  return transport;
}

/** Serializes mediasoup transport parameters for client transport creation. */
export function getTransportOptions(transport: WebRtcTransport): TransportOptions {
  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  };
}
