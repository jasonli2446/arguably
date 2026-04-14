import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server as SocketIOServer } from "socket.io";
import { createWorkers } from "./mediasoup/workers.js";
import { setupSignaling } from "./signaling.js";
import { LISTEN_PORT } from "./config.js";
import { createAuthMiddleware } from "./auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === "production";

// Resolve test-client directory (works for both src/ and dist/)
const testClientDir = path.resolve(__dirname, "..", "test-client");

// ── CORS configuration ──

function getCorsOrigin(): string[] {
  const envOrigins = process.env.ALLOWED_ORIGINS;
  if (envOrigins) {
    return envOrigins.split(",").map((o) => o.trim());
  }
  if (isProduction) {
    console.error(
      "\n[FATAL] ALLOWED_ORIGINS env var is required in production.\n" +
        "Set it to a comma-separated list of allowed origins.\n",
    );
    process.exit(1);
  }
  console.warn(
    "[WARN] ALLOWED_ORIGINS not set — defaulting to localhost only. " +
      "Set ALLOWED_ORIGINS for non-local access.",
  );
  return ["http://localhost:3000", "http://127.0.0.1:3000"];
}

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

  // Serve static test-client files — with path traversal protection
  let decodedUrl: string;
  try {
    decodedUrl = decodeURIComponent(req.url || "/");
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Bad Request");
    return;
  }

  const requestedPath = decodedUrl === "/" ? "/index.html" : decodedUrl;
  const resolvedPath = path.resolve(testClientDir, "." + requestedPath);

  // Verify resolved path is within testClientDir
  if (resolvedPath !== testClientDir && !resolvedPath.startsWith(testClientDir + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(resolvedPath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(resolvedPath, (err, data) => {
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
    origin: getCorsOrigin(),
    methods: ["GET", "POST"],
  },
});

// ── Socket.IO authentication middleware ──
io.use(createAuthMiddleware());

// ── Start ──

async function main(): Promise<void> {
  await createWorkers();
  setupSignaling(io);

  server.listen(LISTEN_PORT, "0.0.0.0", () => {
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
