## ── Builder stage ──
FROM node:20-bookworm-slim AS builder

RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc

## ── Production stage ──
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY test-client/ ./test-client/

EXPOSE 3001
EXPOSE 40000-40100/udp
EXPOSE 40000-40100/tcp

CMD ["node", "dist/index.js"]
