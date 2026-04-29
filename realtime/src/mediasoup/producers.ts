import type {
  Transport,
  Producer,
  MediaKind,
  RtpParameters,
} from "mediasoup/types";

/** Creates a mediasoup producer for a track on an existing transport. */
export async function createProducer(
  transport: Transport,
  kind: MediaKind,
  rtpParameters: RtpParameters,
  appData?: Record<string, unknown>,
): Promise<Producer> {
  const producer = await transport.produce({
    kind,
    rtpParameters,
    appData: appData || {},
  });

  return producer;
}
