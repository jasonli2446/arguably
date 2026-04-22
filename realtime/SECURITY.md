# Realtime Server — Deployment Security Guide

## Credential Management

Default TURN credentials (`arguably` / `arguably-turn-password`) are provided for local development only. **The server will refuse to start in production if defaults are still in use.**

Set strong, unique credentials via environment variables:

```bash
TURN_USERNAME=your-secure-username
TURN_PASSWORD=your-secure-password
NODE_ENV=production
```

Update both the SFU environment (`.env` or `docker-compose.yml`) **and** `turnserver.conf` to match.

## Firewall Requirements

coturn uses `network_mode: host`, which binds directly to host interfaces — Docker network isolation does not apply.

### Required ports

| Port | Protocol | Service | Notes |
|------|----------|---------|-------|
| 3478 | TCP/UDP | TURN listening | Restrict to expected client IP ranges |
| 49152–49252 | UDP | TURN relay range | Restrict to expected client IP ranges |
| 3001 | TCP | SFU (HTTP + Socket.io) | Restrict or place behind reverse proxy |
| 40000–40100 | UDP/TCP | mediasoup RTC | Restrict to expected client IP ranges |

### Example (ufw)

```bash
# Allow TURN from your app's client CIDR
ufw allow from <client-cidr> to any port 3478
ufw allow from <client-cidr> to any port 49152:49252 proto udp

# Allow SFU
ufw allow from <client-cidr> to any port 3001 proto tcp

# Allow mediasoup RTC
ufw allow from <client-cidr> to any port 40000:40100 proto udp
```

## Why `network_mode: host` for coturn?

TURN servers must see real client IPs for relay allocation and need to bind a large UDP port range. Docker's userland proxy adds latency and does not efficiently handle thousands of UDP flows. Host networking avoids these issues at the cost of container network isolation — hence the firewall requirements above.

## Why TURN TLS is not enabled

TLS/DTLS are intentionally disabled on the TURN server. This is safe because:

1. **Media is already encrypted.** WebRTC mandates SRTP — TURN only relays opaque encrypted packets.
2. **Credentials travel over TLS.** TURN credentials are sent to clients via the Socket.io connection, which uses WSS (TLS) in production.
3. **No practical benefit.** Adding TLS to TURN would require certificate provisioning and rotation on the TURN server with no security improvement given (1) and (2).

## Container Resource Limits

Both containers have CPU and memory limits configured in `docker-compose.yml` to prevent a runaway process from consuming all host resources:

- **sfu**: 2 CPUs, 1 GB RAM
- **coturn**: 1 CPU, 512 MB RAM

Adjust these based on expected concurrent session load.
