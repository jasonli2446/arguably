'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { Socket } from 'socket.io-client'
import type { types as mediasoupTypes } from 'mediasoup-client'
import { createClient } from '@/lib/supabase/client'

type ConnectionState = 'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error'

// ── Server response types ──

interface SfuAckResponse {
  success: boolean
  error?: string
  [key: string]: unknown
}

interface RouterCapabilitiesResponse extends SfuAckResponse {
  rtpCapabilities: mediasoupTypes.RtpCapabilities
  iceServers: RTCIceServer[]
}

interface JoinRoomResponse extends SfuAckResponse {
  peers: Array<{ peerId: string; displayName: string }>
  stablePeerId?: string
}

interface CreateTransportResponse extends SfuAckResponse {
  transportOptions: mediasoupTypes.TransportOptions
}

interface ConsumeResponse extends SfuAckResponse {
  id: string
  producerId: string
  kind: mediasoupTypes.MediaKind
  rtpParameters: mediasoupTypes.RtpParameters
  peerId: string
  displayName: string
}

interface GetProducersResponse extends SfuAckResponse {
  producers: Array<{ producerId: string }>
}

// ── Socket event payload types ──

interface NewProducerEvent {
  producerId: string
}

interface ProducerClosedEvent {
  producerId: string
}

interface PeerEvent {
  peerId: string
  displayName: string
}

interface ForceMuteEvent {
  userId: string
}

interface TransportFailureEvent {
  transportId: string
  direction: string
  reason: string
}

// ── Hook interfaces ──

interface RemoteStream {
  stream: MediaStream
  displayName: string
  kind: 'video' | 'audio'
}

interface UseMediasoupOptions {
  sfuUrl: string | undefined
  roomId: string
  displayName: string
  userId?: string
  enabled: boolean
}

interface UseMediasoupReturn {
  connectionState: ConnectionState
  localStream: MediaStream | null
  remoteStreams: Map<string, RemoteStream>
  reconnectingPeers: Set<string>
  audioMuted: boolean
  videoOff: boolean
  serverMuted: boolean
  toggleMute: () => void
  toggleVideo: () => void
  disconnect: () => void
  reconnect: () => void
}

function request(socket: Socket, event: string, data: Record<string, unknown> = {}): Promise<SfuAckResponse> {
  return new Promise((resolve, reject) => {
    socket.emit(event, data, (response: SfuAckResponse) => {
      if (response.success) {
        resolve(response)
      } else {
        reject(new Error(response.error ?? 'Unknown error'))
      }
    })
  })
}

export function useMediasoup({
  sfuUrl,
  roomId,
  displayName,
  userId,
  enabled,
}: UseMediasoupOptions): UseMediasoupReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStreams, setRemoteStreams] = useState<Map<string, RemoteStream>>(new Map())
  const [reconnectingPeers, setReconnectingPeers] = useState<Set<string>>(new Set())
  const [audioMuted, setAudioMuted] = useState(false)
  const [videoOff, setVideoOff] = useState(false)
  const [serverMuted, setServerMuted] = useState(false)
  const [reconnectTrigger, setReconnectTrigger] = useState(0)

  const socketRef = useRef<Socket | null>(null)
  const deviceRef = useRef<mediasoupTypes.Device | null>(null)
  const sendTransportRef = useRef<mediasoupTypes.Transport | null>(null)
  const recvTransportRef = useRef<mediasoupTypes.Transport | null>(null)
  const producersRef = useRef<Map<string, mediasoupTypes.Producer>>(new Map())
  const consumersRef = useRef<Map<string, { consumer: mediasoupTypes.Consumer; peerId: string }>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const peerIdRef = useRef<string | null>(null)
  const routerDataRef = useRef<RouterCapabilitiesResponse | null>(null)
  const cleanedUpRef = useRef(false)

  const cleanup = useCallback(() => {
    if (cleanedUpRef.current) return
    cleanedUpRef.current = true

    for (const [id, producer] of producersRef.current) {
      producer.close()
      if (socketRef.current?.connected) {
        request(socketRef.current, 'closeProducer', { producerId: id }).catch(() => {})
      }
    }
    producersRef.current.clear()

    for (const [, info] of consumersRef.current) {
      info.consumer.close()
    }
    consumersRef.current.clear()

    if (sendTransportRef.current) {
      sendTransportRef.current.close()
      sendTransportRef.current = null
    }
    if (recvTransportRef.current) {
      recvTransportRef.current.close()
      recvTransportRef.current = null
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
      setLocalStream(null)
    }

    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }

    deviceRef.current = null
    setRemoteStreams(new Map())
    setConnectionState('disconnected')
  }, [])

  const disconnect = useCallback(() => {
    cleanup()
  }, [cleanup])

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled
      })
      setAudioMuted((prev) => !prev)
    }
  }, [])

  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = !track.enabled
      })
      setVideoOff((prev) => !prev)
    }
  }, [])

  const reconnect = useCallback(() => {
    cleanup()
    cleanedUpRef.current = false
    setReconnectTrigger((n) => n + 1)
  }, [cleanup])

  const doFreshJoin = useCallback(async (socket: Socket, device: mediasoupTypes.Device): Promise<RouterCapabilitiesResponse> => {
    const routerData = (await request(socket, 'getRouterRtpCapabilities', { roomId })) as RouterCapabilitiesResponse
    routerDataRef.current = routerData

    await device.load({ routerRtpCapabilities: routerData.rtpCapabilities })
    deviceRef.current = device

    const joinResp = (await request(socket, 'joinRoom', {
      roomId,
      displayName,
      rtpCapabilities: device.rtpCapabilities as unknown as Record<string, unknown>,
    })) as JoinRoomResponse

    if (joinResp.stablePeerId) {
      peerIdRef.current = joinResp.stablePeerId
    }

    return routerData
  }, [roomId, displayName])

  const doReconnect = useCallback(async (socket: Socket, device: mediasoupTypes.Device): Promise<RouterCapabilitiesResponse> => {
    if (!peerIdRef.current || !routerDataRef.current) {
      throw new Error('Cannot reconnect: missing peer ID or router data')
    }

    await device.load({ routerRtpCapabilities: routerDataRef.current.rtpCapabilities })
    deviceRef.current = device

    await request(socket, 'reconnect', {
      roomId,
      stablePeerId: peerIdRef.current,
      displayName,
      rtpCapabilities: device.rtpCapabilities as unknown as Record<string, unknown>,
    })

    return routerDataRef.current
  }, [roomId, displayName])

  useEffect(() => {
    if (!enabled || !sfuUrl || !roomId || !displayName) {
      return
    }

    cleanedUpRef.current = false
    let cancelled = false

    async function connect() {
      setConnectionState('connecting')

      try {
        const [{ Device }, { io }] = await Promise.all([
          import('mediasoup-client'),
          import('socket.io-client'),
        ])

        if (cancelled) return

        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) {
          console.error('No auth token available — cannot connect to SFU')
          setConnectionState('error')
          return
        }

        const socket: Socket = io(sfuUrl!, {
          transports: ['websocket'],
          auth: { token: session.access_token },
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          reconnectionAttempts: 5,
        })
        socketRef.current = socket

        socket.on('connect', async () => {
          if (cancelled) return

          try {
            const device = new Device()

            let routerData: RouterCapabilitiesResponse
            if (peerIdRef.current) {
              try {
                routerData = await doReconnect(socket, device)
              } catch {
                peerIdRef.current = null
                routerDataRef.current = null
                routerData = await doFreshJoin(socket, device)
              }
            } else {
              routerData = await doFreshJoin(socket, device)
            }

            const sendData = (await request(socket, 'createWebRtcTransport', { direction: 'send' })) as CreateTransportResponse
            const sendTransport = device.createSendTransport({
              ...sendData.transportOptions,
              iceServers: routerData.iceServers,
            })
            sendTransportRef.current = sendTransport

            sendTransport.on('connect', ({ dtlsParameters }: { dtlsParameters: mediasoupTypes.DtlsParameters }, callback: () => void, errback: (err: Error) => void) => {
              request(socket, 'connectTransport', {
                transportId: sendTransport.id,
                dtlsParameters: dtlsParameters as unknown as Record<string, unknown>,
              })
                .then(callback)
                .catch(errback)
            })

            sendTransport.on('produce', async ({ kind, rtpParameters, appData }: { kind: mediasoupTypes.MediaKind; rtpParameters: mediasoupTypes.RtpParameters; appData: Record<string, unknown> }, callback: (arg: { id: string }) => void, errback: (err: Error) => void) => {
              try {
                const resp = await request(socket, 'produce', {
                  transportId: sendTransport.id,
                  kind,
                  rtpParameters: rtpParameters as unknown as Record<string, unknown>,
                  appData,
                })
                callback({ id: resp.producerId as string })
              } catch (err) {
                errback(err as Error)
              }
            })

            const recvData = (await request(socket, 'createWebRtcTransport', { direction: 'recv' })) as CreateTransportResponse
            const recvTransport = device.createRecvTransport({
              ...recvData.transportOptions,
              iceServers: routerData.iceServers,
            })
            recvTransportRef.current = recvTransport

            recvTransport.on('connect', ({ dtlsParameters }: { dtlsParameters: mediasoupTypes.DtlsParameters }, callback: () => void, errback: (err: Error) => void) => {
              request(socket, 'connectTransport', {
                transportId: recvTransport.id,
                dtlsParameters: dtlsParameters as unknown as Record<string, unknown>,
              })
                .then(callback)
                .catch(errback)
            })

            const stream = await navigator.mediaDevices.getUserMedia({
              video: { width: 640, height: 480 },
              audio: true,
            })
            localStreamRef.current = stream
            setLocalStream(stream)

            const connectionTimeout = setTimeout(() => {
              if (!cancelled) {
                console.error('SFU connection timed out after 15s')
                cleanup()
                cleanedUpRef.current = false
                setConnectionState('error')
              }
            }, 15000)

            const videoTrack = stream.getVideoTracks()[0]
            if (videoTrack) {
              const videoProducer = await sendTransport.produce({ track: videoTrack })
              producersRef.current.set(videoProducer.id, videoProducer)
            }

            const audioTrack = stream.getAudioTracks()[0]
            if (audioTrack) {
              const audioProducer = await sendTransport.produce({ track: audioTrack })
              producersRef.current.set(audioProducer.id, audioProducer)
            }

            const prodData = (await request(socket, 'getProducers')) as GetProducersResponse
            for (const p of prodData.producers) {
              await consumeProducer(socket, recvTransport, p.producerId)
            }

            clearTimeout(connectionTimeout)
            setConnectionState('connected')
          } catch (err) {
            console.error('SFU setup error:', err)
            setConnectionState('error')
          }
        })

        socket.on('disconnect', () => {
          if (!cancelled) {
            setConnectionState('reconnecting')
          }
        })

        socket.on('connect_error', (err: Error) => {
          console.error('SFU connection error:', err)
          if (!cancelled && !peerIdRef.current) {
            setConnectionState('error')
          }
        })

        socket.on('newProducer', async (data: NewProducerEvent) => {
          if (recvTransportRef.current) {
            await consumeProducer(socket, recvTransportRef.current, data.producerId)
          }
        })

        socket.on('producerClosed', (data: ProducerClosedEvent) => {
          for (const [consumerId, info] of consumersRef.current) {
            if (info.consumer.producerId === data.producerId) {
              info.consumer.close()
              consumersRef.current.delete(consumerId)
              setRemoteStreams((prev) => {
                const next = new Map(prev)
                next.delete(data.producerId)
                return next
              })
              break
            }
          }
        })

        socket.on('forceMute', (data: ForceMuteEvent) => {
          if (data.userId === userId && localStreamRef.current) {
            localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = false })
            setAudioMuted(true)
            setServerMuted(true)
          }
        })

        socket.on('forceUnmute', (data: ForceMuteEvent) => {
          if (data.userId === userId && localStreamRef.current) {
            localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = true })
            setAudioMuted(false)
            setServerMuted(false)
          }
        })

        socket.on('peerLeft', (data: PeerEvent) => {
          const toRemove: string[] = []
          for (const [consumerId, info] of consumersRef.current) {
            if (info.peerId === data.peerId) {
              info.consumer.close()
              consumersRef.current.delete(consumerId)
              toRemove.push(info.consumer.producerId)
            }
          }
          if (toRemove.length > 0) {
            setRemoteStreams((prev) => {
              const next = new Map(prev)
              toRemove.forEach((id) => next.delete(id))
              return next
            })
          }
          setReconnectingPeers((prev) => {
            const next = new Set(prev)
            next.delete(data.peerId)
            return next
          })
        })

        socket.on('peerReconnecting', (data: PeerEvent) => {
          console.log('Peer reconnecting:', data.displayName)
          setReconnectingPeers((prev) => new Set(prev).add(data.peerId))
        })

        socket.on('peerReconnected', (data: PeerEvent) => {
          console.log('Peer reconnected:', data.displayName)
          setReconnectingPeers((prev) => {
            const next = new Set(prev)
            next.delete(data.peerId)
            return next
          })
        })

        socket.on('transportFailure', (data: TransportFailureEvent) => {
          console.error('Transport failure:', data)
        })
      } catch (err) {
        console.error('SFU connect error:', err)
        if (!cancelled) {
          setConnectionState('error')
        }
      }
    }

    async function consumeProducer(socket: Socket, recvTransport: mediasoupTypes.Transport, producerId: string) {
      try {
        const data = (await request(socket, 'consume', { producerId })) as ConsumeResponse

        const consumer = await recvTransport.consume({
          id: data.id,
          producerId: data.producerId,
          kind: data.kind,
          rtpParameters: data.rtpParameters,
        })

        consumersRef.current.set(consumer.id, {
          consumer,
          peerId: data.peerId,
        })

        await request(socket, 'resumeConsumer', { consumerId: consumer.id })

        const stream = new MediaStream([consumer.track])
        setRemoteStreams((prev) => {
          const next = new Map(prev)
          next.set(producerId, {
            stream,
            displayName: data.displayName,
            kind: data.kind,
          })
          return next
        })
      } catch (err) {
        console.error('Consume error:', err)
      }
    }

    connect()

    return () => {
      cancelled = true
      cleanup()
    }
  }, [enabled, sfuUrl, roomId, displayName, cleanup, reconnectTrigger])

  return {
    connectionState,
    localStream,
    remoteStreams,
    reconnectingPeers,
    audioMuted,
    videoOff,
    serverMuted,
    toggleMute,
    toggleVideo,
    disconnect,
    reconnect,
  }
}
