import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server as SocketIOServer } from "socket.io";
import { createWorkers } from "./mediasoup/workers.js";
import { setupSignaling } from "./signaling.js";
import { LISTEN_PORT } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve test-client directory (works for both src/ and dist/)
const testClientDir = path.resolve(__dirname, "..", "test-client");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

// ── HTTP Server ──

const server = http.createServer((req, res) => {
  // Health endpoint
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    return;
  }

  // Serve static test-client files
  let filePath = req.url === "/" ? "/index.html" : req.url || "/index.html";
  filePath = path.join(testClientDir, filePath);

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

// ── Socket.io ──

const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// ── Start ──

async function main(): Promise<void> {
  await createWorkers();
  setupSignaling(io);

  server.listen(LISTEN_PORT, () => {
    console.log(`\nArguably Realtime SFU running`);
    console.log(`  HTTP + Socket.io: http://localhost:${LISTEN_PORT}`);
    console.log(`  Test client:      http://localhost:${LISTEN_PORT}/`);
    console.log(`  Health check:     http://localhost:${LISTEN_PORT}/health\n`);
  });
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
