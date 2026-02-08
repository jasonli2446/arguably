import * as mediasoupClient from "https://esm.sh/mediasoup-client@3.18.6";

// ── DOM refs ──
const statusDot = document.getElementById("status-dot");
const serverUrlInput = document.getElementById("server-url");
const roomIdInput = document.getElementById("room-id");
const displayNameInput = document.getElementById("display-name");
const btnConnect = document.getElementById("btn-connect");
const btnPublish = document.getElementById("btn-publish");
const btnStop = document.getElementById("btn-stop");
const videoGrid = document.getElementById("video-grid");
const logMessages = document.getElementById("log-messages");

// ── State ──
let socket = null;
let device = null;
let sendTransport = null;
let recvTransport = null;
let localStream = null;
const producers = new Map(); // producerId -> Producer
const consumers = new Map(); // consumerId -> { consumer, peerId }

// ── Random display name ──
if (!displayNameInput.value) {
  displayNameInput.value = "User-" + Math.random().toString(36).slice(2, 6);
}

// ── Logging ──
function log(msg, level = "info") {
  const entry = document.createElement("div");
  entry.className = `log-entry ${level}`;
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  entry.textContent = `[${ts}] ${msg}`;
  logMessages.appendChild(entry);
  logMessages.scrollTop = logMessages.scrollHeight;
  if (level === "error") console.error(msg);
}

function setStatus(state) {
  statusDot.className = "status-dot " + state;
}

// ── Video grid helpers ──
function addVideo(id, stream, label) {
  if (document.getElementById(`video-${id}`)) return;
  const container = document.createElement("div");
  container.className = "video-container";
  container.id = `video-${id}`;

  const video = document.createElement("video");
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  if (id === "local") video.muted = true;

  const labelEl = document.createElement("div");
  labelEl.className = "video-label";
  labelEl.textContent = label;

  container.appendChild(video);
  container.appendChild(labelEl);
  videoGrid.appendChild(container);
}

function removeVideo(id) {
  const el = document.getElementById(`video-${id}`);
  if (el) el.remove();
}

// ── Socket.io emit with ack ──
function request(event, data = {}) {
  return new Promise((resolve, reject) => {
    socket.emit(event, data, (response) => {
      if (response.success) {
        resolve(response);
      } else {
        reject(new Error(response.error || "Unknown error"));
      }
    });
  });
}

// ── Connect ──
btnConnect.addEventListener("click", async () => {
  if (socket && socket.connected) {
    disconnect();
    return;
  }

  const serverUrl = serverUrlInput.value.trim();
  const roomId = roomIdInput.value.trim();
  const displayName = displayNameInput.value.trim();

  if (!serverUrl || !roomId || !displayName) {
    log("Please fill in all fields", "warn");
    return;
  }

  try {
    log(`Connecting to ${serverUrl}...`);
    socket = io(serverUrl, { transports: ["websocket"] });

    socket.on("connect", async () => {
      log("Socket connected", "success");
      setStatus("connected");
      btnConnect.textContent = "Disconnect";

      try {
        // 1. Get router RTP capabilities
        log("Getting router RTP capabilities...");
        const routerData = await request("getRouterRtpCapabilities", { roomId });
        log("Router capabilities received", "success");

        // 2. Load mediasoup Device
        device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities: routerData.rtpCapabilities });
        log("mediasoup Device loaded", "success");

        // 3. Join room
        log(`Joining room: ${roomId}...`);
        const joinData = await request("joinRoom", {
          roomId,
          displayName,
          rtpCapabilities: device.rtpCapabilities,
        });
        log(`Joined room. ${joinData.peers.length} peer(s) already in room.`, "success");

        // 4. Create send transport
        await createSendTransport();

        // 5. Create recv transport
        await createRecvTransport();

        // 6. Consume existing producers
        btnPublish.disabled = false;
        await consumeExistingProducers();
      } catch (err) {
        log(`Setup error: ${err.message}`, "error");
      }
    });

    socket.on("disconnect", () => {
      log("Socket disconnected", "warn");
      setStatus("");
      cleanup();
    });

    socket.on("connect_error", (err) => {
      log(`Connection error: ${err.message}`, "error");
      setStatus("error");
    });

    // ── Server events ──
    socket.on("newProducer", async (data) => {
      log(`New producer: ${data.kind} from ${data.displayName}`, "info");
      await consumeProducer(data.producerId);
    });

    socket.on("producerClosed", (data) => {
      log(`Producer closed: ${data.producerId}`, "warn");
      // Find and close matching consumer
      for (const [consumerId, info] of consumers) {
        if (info.consumer.producerId === data.producerId) {
          info.consumer.close();
          consumers.delete(consumerId);
          removeVideo(`remote-${data.producerId}`);
          break;
        }
      }
    });

    socket.on("peerJoined", (data) => {
      log(`Peer joined: ${data.displayName} (${data.peerId})`, "success");
    });

    socket.on("peerLeft", (data) => {
      log(`Peer left: ${data.displayName} (${data.peerId})`, "warn");
      // Remove all videos for this peer
      for (const [consumerId, info] of consumers) {
        if (info.peerId === data.peerId) {
          info.consumer.close();
          consumers.delete(consumerId);
          removeVideo(`remote-${info.consumer.producerId}`);
        }
      }
    });
  } catch (err) {
    log(`Connect error: ${err.message}`, "error");
    setStatus("error");
  }
});

// ── Create Send Transport ──
async function createSendTransport() {
  const data = await request("createWebRtcTransport", { direction: "send" });
  log("Send transport created");

  sendTransport = device.createSendTransport({
    ...data.transportOptions,
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
    ],
  });

  sendTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
    request("connectTransport", {
      transportId: sendTransport.id,
      dtlsParameters,
    })
      .then(callback)
      .catch(errback);
  });

  sendTransport.on("produce", async ({ kind, rtpParameters, appData }, callback, errback) => {
    try {
      const resp = await request("produce", {
        transportId: sendTransport.id,
        kind,
        rtpParameters,
        appData,
      });
      callback({ id: resp.producerId });
    } catch (err) {
      errback(err);
    }
  });

  sendTransport.on("connectionstatechange", (state) => {
    log(`Send transport state: ${state}`);
  });
}

// ── Create Recv Transport ──
async function createRecvTransport() {
  const data = await request("createWebRtcTransport", { direction: "recv" });
  log("Recv transport created");

  recvTransport = device.createRecvTransport({
    ...data.transportOptions,
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
    ],
  });

  recvTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
    request("connectTransport", {
      transportId: recvTransport.id,
      dtlsParameters,
    })
      .then(callback)
      .catch(errback);
  });

  recvTransport.on("connectionstatechange", (state) => {
    log(`Recv transport state: ${state}`);
  });
}

// ── Consume existing producers ──
async function consumeExistingProducers() {
  try {
    const data = await request("getProducers");
    log(`Found ${data.producers.length} existing producer(s)`);
    for (const p of data.producers) {
      await consumeProducer(p.producerId);
    }
  } catch (err) {
    log(`Error getting producers: ${err.message}`, "error");
  }
}

// ── Consume a single producer ──
async function consumeProducer(producerId) {
  try {
    const data = await request("consume", { producerId });

    const consumer = await recvTransport.consume({
      id: data.id,
      producerId: data.producerId,
      kind: data.kind,
      rtpParameters: data.rtpParameters,
    });

    consumers.set(consumer.id, {
      consumer,
      peerId: data.peerId,
    });

    // Resume the consumer on the server
    await request("resumeConsumer", { consumerId: consumer.id });

    // Display video/audio
    const stream = new MediaStream([consumer.track]);
    if (data.kind === "video") {
      addVideo(`remote-${producerId}`, stream, `${data.displayName} (${data.kind})`);
    } else {
      // For audio, create a hidden audio element
      const audio = document.createElement("audio");
      audio.srcObject = stream;
      audio.autoplay = true;
      audio.id = `audio-${producerId}`;
      document.body.appendChild(audio);
    }

    log(`Consuming ${data.kind} from ${data.displayName}`, "success");
  } catch (err) {
    log(`Consume error: ${err.message}`, "error");
  }
}

// ── Publish ──
btnPublish.addEventListener("click", async () => {
  try {
    log("Requesting camera + microphone...");
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: true,
    });

    // Show local preview
    addVideo("local", localStream, "You (local)");

    // Produce video
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      const videoProducer = await sendTransport.produce({ track: videoTrack });
      producers.set(videoProducer.id, videoProducer);
      log(`Video producer created: ${videoProducer.id}`, "success");
    }

    // Produce audio
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      const audioProducer = await sendTransport.produce({ track: audioTrack });
      producers.set(audioProducer.id, audioProducer);
      log(`Audio producer created: ${audioProducer.id}`, "success");
    }

    btnPublish.disabled = true;
    btnStop.disabled = false;
  } catch (err) {
    log(`Publish error: ${err.message}`, "error");
  }
});

// ── Stop publishing ──
btnStop.addEventListener("click", () => {
  stopPublishing();
});

function stopPublishing() {
  for (const [id, producer] of producers) {
    producer.close();
    request("closeProducer", { producerId: id }).catch(() => {});
    log(`Producer closed: ${id}`);
  }
  producers.clear();

  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }

  removeVideo("local");
  btnPublish.disabled = false;
  btnStop.disabled = true;
}

// ── Disconnect ──
function disconnect() {
  stopPublishing();
  cleanup();

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  btnConnect.textContent = "Connect";
  setStatus("");
  log("Disconnected");
}

function cleanup() {
  btnPublish.disabled = true;
  btnStop.disabled = true;

  for (const [, info] of consumers) {
    info.consumer.close();
  }
  consumers.clear();

  if (sendTransport) {
    sendTransport.close();
    sendTransport = null;
  }
  if (recvTransport) {
    recvTransport.close();
    recvTransport = null;
  }

  device = null;

  // Remove all video elements
  videoGrid.innerHTML = "";

  // Remove hidden audio elements
  document.querySelectorAll("audio[id^='audio-']").forEach((el) => el.remove());
}
