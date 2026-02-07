import type {
  Router,
  Transport,
  Consumer,
  RtpCapabilities,
} from "mediasoup/types";

export async function createConsumer(
  router: Router,
  transport: Transport,
  producerId: string,
  rtpCapabilities: RtpCapabilities,
): Promise<Consumer> {
  if (!router.canConsume({ producerId, rtpCapabilities })) {
    throw new Error("Cannot consume: incompatible RTP capabilities");
  }

  const consumer = await transport.consume({
    producerId,
    rtpCapabilities,
    paused: true, // Start paused; client calls resumeConsumer after setup
  });

  return consumer;
}
