import type { Router, WebRtcTransport } from "mediasoup/types";
import type { TransportOptions } from "../types.js";
import { webRtcTransportOptions } from "../config.js";

export async function createWebRtcTransport(
  router: Router,
): Promise<WebRtcTransport> {
  const transport = await router.createWebRtcTransport(webRtcTransportOptions);
  return transport;
}

export function getTransportOptions(transport: WebRtcTransport): TransportOptions {
  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  };
}
