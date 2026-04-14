'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting'

interface RemoteStream {
  stream: MediaStream
  displayName: string
  kind: 'video' | 'audio'
}

interface UseMediasoupOptions {
  sfuUrl: string | undefined
  roomId: string
  displayName: string
  enabled: boolean
}

interface UseMediasoupReturn {
  connectionState: ConnectionState
  localStream: MediaStream | null
  remoteStreams: Map<string, RemoteStream>
  reconnectingPeers: Set<string>
  audioMuted: boolean
  videoOff: boolean
  toggleMute: () => void
  toggleVideo: () => void
  disconnect: () => void
  reconnect: () => void
}

// Socket.io emit with ack helper
function request(socket: any, event: string, data: Record<string, any> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    socket.emit(event, data, (response: any) => {
      if (response.success) {
        resolve(response)
      } else {
        reject(new Error(response.error || 'Unknown error'))
      }
    })
  })
}

export function useMediasoup({
  sfuUrl,
  roomId,
  displayName,
  enabled,
}: UseMediasoupOptions): UseMediasoupReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStreams, setRemoteStreams] = useState<Map<string, RemoteStream>>(new Map())
  const [reconnectingPeers, setReconnectingPeers] = useState<Set<string>>(new Set())
  const [audioMuted, setAudioMuted] = useState(false)
  const [videoOff, setVideoOff] = useState(false)
  const [reconnectTrigger, setReconnectTrigger] = useState(0)

  const socketRef = useRef<any>(null)
  const deviceRef = useRef<any>(null)
  const sendTransportRef = useRef<any>(null)
  const recvTransportRef = useRef<any>(null)
  const producersRef = useRef<Map<string, any>>(new Map())
  const consumersRef = useRef<Map<string, { consumer: any; peerId: string }>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const cleanedUpRef = useRef(false)
  const peerIdRef = useRef<string | null>(null)
  const routerDataRef = useRef<any>(null)

  const cleanup = useCallback(() => {
    if (cleanedUpRef.current) return
    cleanedUpRef.current = true

    // Close producers
    for (const [id, producer] of producersRef.current) {
      producer.close()
      if (socketRef.current?.connected) {
        request(socketRef.current, 'closeProducer', { producerId: id }).catch(() => {})
      }
    }
    producersRef.current.clear()

    // Close consumers
    for (const [, info] of consumersRef.current) {
      info.consumer.close()
    }
    consumersRef.current.clear()

    // Close transports
    if (sendTransportRef.current) {
      sendTransportRef.current.close()
      sendTransportRef.current = null
    }
    if (recvTransportRef.current) {
      recvTransportRef.current.close()
      recvTransportRef.current = null
    }

    // Stop local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t: MediaStreamTrack) => t.stop())
      localStreamRef.current = null
      setLocalStream(null)
    }

    // Disconnect socket
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }

    peerIdRef.current = null
    deviceRef.current = null
    routerDataRef.current = null
    setRemoteStreams(new Map())
    setReconnectingPeers(new Set())
    setConnectionState('disconnected')
  }, [])

  const disconnect = useCallback(() => {
    cleanup()
  }, [cleanup])

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks()
      audioTracks.forEach((track) => {
        track.enabled = !track.enabled
      })
      setAudioMuted((prev) => !prev)
    }
  }, [])

  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks()
      videoTracks.forEach((track) => {
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

  useEffect(() => {
    if (!enabled || !sfuUrl || !roomId || !displayName) {
      return
    }

    cleanedUpRef.current = false
    let cancelled = false

    // Helper: create transports, produce local tracks, consume remote producers
    async function setupMediaState(
      socket: any,
      device: any,
      iceServers: any,
      producersList?: Array<{ producerId: string }>,
    ) {
      // Create send transport
      const sendData = await request(socket, 'createWebRtcTransport', { direction: 'send' })
      const sendTransport = device.createSendTransport({
        ...sendData.transportOptions,
        iceServers,
      })
      sendTransportRef.current = sendTransport

      sendTransport.on('connect', ({ dtlsParameters }: any, callback: () => void, errback: (err: Error) => void) => {
        request(socket, 'connectTransport', {
          transportId: sendTransport.id,
          dtlsParameters,
        })
          .then(callback)
          .catch(errback)
      })

      sendTransport.on('produce', async ({ kind, rtpParameters, appData }: any, callback: (arg: { id: string }) => void, errback: (err: Error) => void) => {
        try {
          const resp = await request(socket, 'produce', {
            transportId: sendTransport.id,
            kind,
            rtpParameters,
            appData,
          })
          callback({ id: resp.producerId })
        } catch (err: any) {
          errback(err)
        }
      })

      // Create recv transport
      const recvData = await request(socket, 'createWebRtcTransport', { direction: 'recv' })
      const recvTransport = device.createRecvTransport({
        ...recvData.transportOptions,
        iceServers,
      })
      recvTransportRef.current = recvTransport

      recvTransport.on('connect', ({ dtlsParameters }: any, callback: () => void, errback: (err: Error) => void) => {
        request(socket, 'connectTransport', {
          transportId: recvTransport.id,
          dtlsParameters,
        })
          .then(callback)
          .catch(errback)
      })

      // Get or reuse local media
      if (!localStreamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: true,
        })
        localStreamRef.current = stream
        setLocalStream(stream)
      }

      // Produce local tracks
      const videoTrack = localStreamRef.current!.getVideoTracks()[0]
      if (videoTrack && videoTrack.readyState === 'live') {
        const videoProducer = await sendTransport.produce({ track: videoTrack })
        producersRef.current.set(videoProducer.id, videoProducer)
      }

      const audioTrack = localStreamRef.current!.getAudioTracks()[0]
      if (audioTrack && audioTrack.readyState === 'live') {
        const audioProducer = await sendTransport.produce({ track: audioTrack })
        producersRef.current.set(audioProducer.id, audioProducer)
      }

      // Consume remote producers
      const producers = producersList ?? (await request(socket, 'getProducers')).producers
      for (const p of producers) {
        await consumeProducer(socket, recvTransport, p.producerId)
      }
    }

    // Fresh join: first time connecting to a room
    async function doFreshJoin(socket: any, device: any) {
      // 1. Get router RTP capabilities
      const routerData = await request(socket, 'getRouterRtpCapabilities', { roomId })
      routerDataRef.current = routerData

      // 2. Load mediasoup Device
      if (!device.loaded) {
        await device.load({ routerRtpCapabilities: routerData.rtpCapabilities })
      }

      // 3. Join room
      const joinResult = await request(socket, 'joinRoom', {
        roomId,
        displayName,
        rtpCapabilities: device.rtpCapabilities,
      })
      peerIdRef.current = joinResult.stablePeerId

      // 4. Setup media (transports, produce, consume)
      await setupMediaState(socket, device, routerData.iceServers)
    }

    // Reconnect: rejoin with existing stable peer ID
    async function doReconnect(socket: any, device: any) {
      const routerData = routerDataRef.current ?? await request(socket, 'getRouterRtpCapabilities', { roomId })
      routerDataRef.current = routerData

      if (!device.loaded) {
        await device.load({ routerRtpCapabilities: routerData.rtpCapabilities })
      }

      const result = await request(socket, 'reconnect', {
        roomId,
        stablePeerId: peerIdRef.current,
        displayName,
        rtpCapabilities: device.rtpCapabilities,
      })

      // Rebuild media state with the producers list from reconnect response
      await setupMediaState(socket, device, routerData.iceServers, result.producers)
    }

    async function connect() {
      setConnectionState('connecting')

      try {
        // Dynamic imports to avoid SSR issues
        const [{ Device }, { io }] = await Promise.all([
          import('mediasoup-client'),
          import('socket.io-client'),
        ])

        if (cancelled) return

        const socket = io(sfuUrl!, {
          transports: ['websocket'],
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
        })
        socketRef.current = socket

        const device = new Device()
        deviceRef.current = device

        socket.on('connect', async () => {
          if (cancelled) return

          try {
            if (peerIdRef.current) {
              // ── Reconnection flow ──
              // Clear stale mediasoup client state before rebuilding
              for (const [, producer] of producersRef.current) {
                producer.close()
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

              // Reset cleanedUpRef so cleanup works if needed later
              cleanedUpRef.current = false

              try {
                await doReconnect(socket, device)
                setConnectionState('connected')
                console.log('SFU reconnected successfully')
                return
              } catch (err) {
                console.warn('Reconnection failed, falling back to fresh join:', err)
                peerIdRef.current = null
              }
            }

            // ── Fresh join flow ──
            await doFreshJoin(socket, device)
            setConnectionState('connected')
          } catch (err: any) {
            console.error('SFU setup error:', err)
            setConnectionState('error')
          }
        })

        socket.on('disconnect', () => {
          if (cancelled || cleanedUpRef.current) return
          // Don't cleanup — Socket.IO will auto-reconnect.
          // Set state to reconnecting so UI shows the right indicator.
          setConnectionState('reconnecting')
        })

        socket.on('connect_error', (err: Error) => {
          console.error('SFU connection error:', err)
          if (cancelled) return
          // Only show error if we haven't connected before (no peerId)
          if (!peerIdRef.current) {
            setConnectionState('error')
          }
          // Otherwise, stay in 'reconnecting' state — Socket.IO keeps trying
        })

        // ── Server events ──

        socket.on('newProducer', async (data: any) => {
          if (recvTransportRef.current) {
            await consumeProducer(socket, recvTransportRef.current, data.producerId)
          }
        })

        socket.on('producerClosed', (data: any) => {
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

        socket.on('peerLeft', (data: any) => {
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
          // Clear from reconnecting set if present
          setReconnectingPeers((prev) => {
            const next = new Set(prev)
            next.delete(data.peerId)
            return next
          })
        })

        // ── Reconnection events for remote peers ──

        socket.on('peerReconnecting', (data: any) => {
          console.log(`Peer ${data.displayName} is reconnecting...`)
          setReconnectingPeers((prev) => {
            const next = new Set(prev)
            next.add(data.peerId)
            return next
          })
        })

        socket.on('peerReconnected', (data: any) => {
          console.log(`Peer ${data.displayName} reconnected`)
          setReconnectingPeers((prev) => {
            const next = new Set(prev)
            next.delete(data.peerId)
            return next
          })
        })

        // ── Transport failure notification ──

        socket.on('transportFailure', (data: any) => {
          console.warn(`Transport failure [${data.direction}]: ${data.reason}`)
        })
      } catch (err: any) {
        console.error('SFU connect error:', err)
        if (!cancelled) {
          setConnectionState('error')
        }
      }
    }

    async function consumeProducer(socket: any, recvTransport: any, producerId: string) {
      try {
        const data = await request(socket, 'consume', { producerId })

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
      } catch (err: any) {
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
    toggleMute,
    toggleVideo,
    disconnect,
    reconnect,
  }
}
