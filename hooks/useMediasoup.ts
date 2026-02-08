'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

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
  audioMuted: boolean
  videoOff: boolean
  toggleMute: () => void
  toggleVideo: () => void
  disconnect: () => void
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
  const [audioMuted, setAudioMuted] = useState(false)
  const [videoOff, setVideoOff] = useState(false)

  const socketRef = useRef<any>(null)
  const deviceRef = useRef<any>(null)
  const sendTransportRef = useRef<any>(null)
  const recvTransportRef = useRef<any>(null)
  const producersRef = useRef<Map<string, any>>(new Map())
  const consumersRef = useRef<Map<string, { consumer: any; peerId: string }>>(new Map())
  const localStreamRef = useRef<MediaStream | null>(null)
  const cleanedUpRef = useRef(false)

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

    deviceRef.current = null
    setRemoteStreams(new Map())
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

  useEffect(() => {
    if (!enabled || !sfuUrl || !roomId || !displayName) {
      return
    }

    cleanedUpRef.current = false
    let cancelled = false

    async function connect() {
      setConnectionState('connecting')

      try {
        // Dynamic imports to avoid SSR issues
        const [{ Device }, { io }] = await Promise.all([
          import('mediasoup-client'),
          import('socket.io-client'),
        ])

        if (cancelled) return

        const socket = io(sfuUrl!, { transports: ['websocket'] })
        socketRef.current = socket

        socket.on('connect', async () => {
          if (cancelled) return

          try {
            // 1. Get router RTP capabilities
            const routerData = await request(socket, 'getRouterRtpCapabilities', { roomId })

            // 2. Load mediasoup Device
            const device = new Device()
            await device.load({ routerRtpCapabilities: routerData.rtpCapabilities })
            deviceRef.current = device

            // 3. Join room
            await request(socket, 'joinRoom', {
              roomId,
              displayName,
              rtpCapabilities: device.rtpCapabilities,
            })

            // 4. Create send transport
            const sendData = await request(socket, 'createWebRtcTransport', { direction: 'send' })
            const sendTransport = device.createSendTransport({
              ...sendData.transportOptions,
              iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
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

            // 5. Create recv transport
            const recvData = await request(socket, 'createWebRtcTransport', { direction: 'recv' })
            const recvTransport = device.createRecvTransport({
              ...recvData.transportOptions,
              iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
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

            // 6. Get user media and produce
            const stream = await navigator.mediaDevices.getUserMedia({
              video: { width: 640, height: 480 },
              audio: true,
            })
            localStreamRef.current = stream
            setLocalStream(stream)

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

            // 7. Consume existing producers
            const prodData = await request(socket, 'getProducers')
            for (const p of prodData.producers) {
              await consumeProducer(socket, recvTransport, p.producerId)
            }

            setConnectionState('connected')
          } catch (err: any) {
            console.error('SFU setup error:', err)
            setConnectionState('error')
          }
        })

        socket.on('disconnect', () => {
          if (!cancelled) {
            setConnectionState('disconnected')
          }
        })

        socket.on('connect_error', (err: Error) => {
          console.error('SFU connection error:', err)
          if (!cancelled) {
            setConnectionState('error')
          }
        })

        // Server events
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
  }, [enabled, sfuUrl, roomId, displayName, cleanup])

  return {
    connectionState,
    localStream,
    remoteStreams,
    audioMuted,
    videoOff,
    toggleMute,
    toggleVideo,
    disconnect,
  }
}
