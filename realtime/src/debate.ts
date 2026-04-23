import type { Server as SocketIOServer } from "socket.io";
import type {
  DebateParticipant,
  DebateFormat,
  DebatePhase,
  TurnReason,
  TurnChangedPayload,
  TurnExpiringPayload,
  TurnWarningPayload,
  DebatePausedPayload,
  DebateResumedPayload,
  DebateEndedPayload,
  DebateStatePayload,
} from "./types.js";
import {
  persistDebateState,
  loadDebateState,
  loadAllActiveDebates,
  logTurnTransition,
  getSessionByCode,
  getSessionCodeById,
  validateDebaterIds,
  isHostOrModerator,
  type DbDebateState,
} from "./db.js";
import { getRoom } from "./mediasoup/rooms.js";
import { createLogger } from "./logger.js";

const log = createLogger("debate");

// ── Constants ──

const GRACE_PERIOD_MS = 3000;
const WARNING_THRESHOLDS = [30, 10]; // seconds remaining
const DEBOUNCE_MS = 500;

// ── Internal State ──

interface InternalDebateState {
  id: string; // DB row ID
  sessionId: string; // DB session.id (CUID)
  roomCode: string; // Socket.io room = session.code
  format: DebateFormat;
  debaterOrder: DebateParticipant[];
  currentIndex: number;
  turnLength: number; // seconds
  turnStartedAt: number | null; // Date.now() when turn began
  isPaused: boolean;
  pausedTimeRemaining: number; // seconds
  phase: DebatePhase;
  formatMeta: Record<string, unknown> | null;
  version: number;

  // Timers (not persisted)
  turnTimer: ReturnType<typeof setTimeout> | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
  warningTimers: ReturnType<typeof setTimeout>[];
  lastAdvanceAt: number; // debounce guard
}

const debates = new Map<string, InternalDebateState>();

// Map roomCode -> sessionId for lookups
const codeToSessionId = new Map<string, string>();

// ── Public API ──

export async function startDebate(
  roomCode: string,
  debaters: DebateParticipant[],
  turnLength: number,
  format: DebateFormat,
  formatMeta: Record<string, unknown> | null,
  io: SocketIOServer,
): Promise<{ success: boolean; error?: string }> {
  // Validate inputs
  if (turnLength < 1 || turnLength > 1800) {
    return { success: false, error: "Turn length must be 1-1800 seconds" };
  }
  if (debaters.length < 2) {
    return { success: false, error: "At least 2 debaters required" };
  }

  // Format-specific validation
  if (format === "ONE_ON_ONE" && debaters.length !== 2) {
    return { success: false, error: "One-on-One requires exactly 2 debaters" };
  }
  if (format === "PANEL" && (debaters.length < 3 || debaters.length > 6)) {
    return { success: false, error: "Panel requires 3-6 debaters" };
  }

  // Lookup session in DB
  const session = await getSessionByCode(roomCode);
  if (!session) {
    return { success: false, error: "Session not found" };
  }

  // Validate debater IDs are actual participants
  const debaterIds = debaters.map((d) => d.userId);
  const valid = await validateDebaterIds(session.id, debaterIds);
  if (!valid) {
    return { success: false, error: "Invalid debater IDs" };
  }

  // Check format matches session type
  if (format !== session.type) {
    return { success: false, error: "Format does not match session type" };
  }

  const id = `ds_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`;
  const now = Date.now();

  const state: InternalDebateState = {
    id,
    sessionId: session.id,
    roomCode,
    format,
    debaterOrder: debaters,
    currentIndex: 0,
    turnLength,
    turnStartedAt: now,
    isPaused: false,
    pausedTimeRemaining: turnLength,
    phase: "ACTIVE",
    formatMeta,
    version: 0,
    turnTimer: null,
    graceTimer: null,
    warningTimers: [],
    lastAdvanceAt: 0,
  };

  debates.set(roomCode, state);
  codeToSessionId.set(roomCode, session.id);

  // Persist before emitting
  await persistState(state);

  // Log the first turn start
  await logTurnTransition({
    debateStateId: id,
    speakerUserId: debaters[0].userId,
    speakerName: debaters[0].displayName,
    turnIndex: 0,
    reason: "DEBATE_START",
    startedAt: new Date(now),
    endedAt: new Date(now),
    durationSec: 0,
  });

  // Start timers
  scheduleTimers(state, io);

  // Broadcast
  const payload: TurnChangedPayload = {
    version: state.version,
    currentIndex: 0,
    debaterOrder: debaters,
    turnStartedAt: now,
    turnLength,
    phase: "ACTIVE",
  };
  io.to(roomCode).emit("turnChanged", payload);

  return { success: true };
}

export async function advanceTurn(
  roomCode: string,
  reason: TurnReason,
  io: SocketIOServer,
  requestVersion?: number,
): Promise<{ success: boolean; error?: string }> {
  const state = debates.get(roomCode);
  if (!state) return { success: false, error: "No active debate" };

  // Debounce guard
  const now = Date.now();
  if (now - state.lastAdvanceAt < DEBOUNCE_MS) {
    return { success: false, error: "Too fast" };
  }

  // Version check for idempotency (if provided)
  if (requestVersion !== undefined && requestVersion !== state.version) {
    return { success: false, error: "Stale version" };
  }

  // Can only advance from ACTIVE phase
  if (state.phase !== "ACTIVE" && state.phase !== "GRACE") {
    return { success: false, error: "Debate is not active" };
  }

  state.lastAdvanceAt = now;

  // Log the ending turn
  const currentSpeaker = state.debaterOrder[state.currentIndex];
  if (currentSpeaker && state.turnStartedAt) {
    await logTurnTransition({
      debateStateId: state.id,
      speakerUserId: currentSpeaker.userId,
      speakerName: currentSpeaker.displayName,
      turnIndex: state.currentIndex,
      reason,
      startedAt: new Date(state.turnStartedAt),
      endedAt: new Date(now),
      durationSec: (now - state.turnStartedAt) / 1000,
    });
  }

  // Clear all timers
  clearAllTimers(state);

  // Compute next turn
  const nextIndex = getNextIndex(state);
  state.currentIndex = nextIndex;
  state.turnStartedAt = now;
  state.phase = "ACTIVE";
  state.version++;

  // Persist before emitting
  await persistState(state);

  // Unmute new speaker, mute old speaker
  muteDebater(roomCode, currentSpeaker?.userId, io);
  unmuteDebater(roomCode, state.debaterOrder[nextIndex]?.userId, io);

  // Schedule new timers
  scheduleTimers(state, io);

  // Broadcast
  const payload: TurnChangedPayload = {
    version: state.version,
    currentIndex: nextIndex,
    debaterOrder: state.debaterOrder,
    turnStartedAt: now,
    turnLength: state.turnLength,
    phase: "ACTIVE",
  };
  io.to(roomCode).emit("turnChanged", payload);

  return { success: true };
}

export async function pauseDebate(
  roomCode: string,
  io: SocketIOServer,
): Promise<{ success: boolean; error?: string }> {
  const state = debates.get(roomCode);
  if (!state) return { success: false, error: "No active debate" };
  if (state.phase !== "ACTIVE") return { success: false, error: "Not active" };

  clearAllTimers(state);

  const now = Date.now();
  const remaining = state.turnStartedAt
    ? Math.max(0, state.turnLength - (now - state.turnStartedAt) / 1000)
    : state.pausedTimeRemaining;

  state.isPaused = true;
  state.pausedTimeRemaining = remaining;
  state.turnStartedAt = null;
  state.phase = "PAUSED";
  state.version++;

  await persistState(state);

  const payload: DebatePausedPayload = {
    version: state.version,
    timeRemaining: remaining,
  };
  io.to(roomCode).emit("debatePaused", payload);

  return { success: true };
}

export async function resumeDebate(
  roomCode: string,
  io: SocketIOServer,
): Promise<{ success: boolean; error?: string }> {
  const state = debates.get(roomCode);
  if (!state) return { success: false, error: "No active debate" };
  if (state.phase !== "PAUSED") return { success: false, error: "Not paused" };

  const now = Date.now();
  state.isPaused = false;
  state.turnStartedAt = now;
  // turnLength temporarily adjusted to the remaining time for this turn
  const effectiveTurnLength = state.pausedTimeRemaining;
  state.phase = "ACTIVE";
  state.version++;

  await persistState(state);

  // Schedule timers for the remaining time
  scheduleTimersWithDuration(state, effectiveTurnLength, io);

  const payload: DebateResumedPayload = {
    version: state.version,
    turnStartedAt: now,
    turnLength: effectiveTurnLength,
  };
  io.to(roomCode).emit("debateResumed", payload);

  return { success: true };
}

export async function endDebate(
  roomCode: string,
  io: SocketIOServer,
): Promise<{ success: boolean; error?: string }> {
  const state = debates.get(roomCode);
  if (!state) return { success: false, error: "No active debate" };

  clearAllTimers(state);

  // Log the final turn
  const currentSpeaker = state.debaterOrder[state.currentIndex];
  if (currentSpeaker && state.turnStartedAt) {
    const now = Date.now();
    await logTurnTransition({
      debateStateId: state.id,
      speakerUserId: currentSpeaker.userId,
      speakerName: currentSpeaker.displayName,
      turnIndex: state.currentIndex,
      reason: "MANUAL_ADVANCE",
      startedAt: new Date(state.turnStartedAt),
      endedAt: new Date(now),
      durationSec: (now - state.turnStartedAt) / 1000,
    });
  }

  state.phase = "ENDED";
  state.version++;

  // Delete from DB (TurnLogs cascade from DebateState, but we keep them by
  // just updating phase instead of deleting)
  await persistState(state);

  debates.delete(roomCode);
  codeToSessionId.delete(roomCode);

  const payload: DebateEndedPayload = { version: state.version };
  io.to(roomCode).emit("debateEnded", payload);

  return { success: true };
}

export function getState(roomCode: string): DebateStatePayload | null {
  const state = debates.get(roomCode);
  if (!state) return null;

  return {
    version: state.version,
    debaterOrder: state.debaterOrder,
    currentIndex: state.currentIndex,
    turnLength: state.turnLength,
    turnStartedAt: state.turnStartedAt,
    isPaused: state.isPaused,
    pausedTimeRemaining: state.pausedTimeRemaining,
    format: state.format,
    formatMeta: state.formatMeta,
    phase: state.phase,
  };
}

export async function handleSpeakerDisconnect(
  roomCode: string,
  userId: string,
  io: SocketIOServer,
): Promise<void> {
  const state = debates.get(roomCode);
  if (!state || state.phase !== "ACTIVE") return;

  const currentSpeaker = state.debaterOrder[state.currentIndex];
  if (currentSpeaker?.userId === userId) {
    await advanceTurn(roomCode, "SPEAKER_DISCONNECT", io);
  }
}

export async function checkAuthorization(
  roomCode: string,
  userId: string,
): Promise<boolean> {
  const sessionId = codeToSessionId.get(roomCode);
  if (!sessionId) {
    // Try DB lookup
    const session = await getSessionByCode(roomCode);
    if (!session) return false;
    return isHostOrModerator(session.id, userId);
  }
  return isHostOrModerator(sessionId, userId);
}

// ── Restart Recovery ──

export async function recoverDebates(io: SocketIOServer): Promise<void> {
  try {
    const rows = await loadAllActiveDebates();
    log.info({}, `[debate] Recovering ${rows.length} active debate(s)...`);

    for (const row of rows) {
      await recoverDebateFromRow(row, io);
    }
  } catch (err) {
    log.error({ err }, "[debate] Recovery failed");
  }
}

async function recoverDebateFromRow(
  row: DbDebateState,
  io: SocketIOServer,
): Promise<void> {
  // Look up the session code from session_id
  const sessionCode = await getSessionCodeById(row.session_id);
  if (!sessionCode) {
    log.warn({}, `[debate] Cannot recover session ${row.session_id}: session not found`);
    return;
  }

  const debaterOrder = row.debater_order as DebateParticipant[];
  const now = Date.now();

  const state: InternalDebateState = {
    id: row.id,
    sessionId: row.session_id,
    roomCode: sessionCode,
    format: row.format as DebateFormat,
    debaterOrder,
    currentIndex: row.current_index,
    turnLength: row.turn_length,
    turnStartedAt: null,
    isPaused: row.is_paused,
    pausedTimeRemaining: row.paused_time_remaining,
    phase: row.phase as DebatePhase,
    formatMeta: row.format_meta as Record<string, unknown> | null,
    version: row.version,
    turnTimer: null,
    graceTimer: null,
    warningTimers: [],
    lastAdvanceAt: 0,
  };

  debates.set(sessionCode, state);
  codeToSessionId.set(sessionCode, row.session_id);

  // Phase-aware recovery
  if (state.phase === "PAUSED") {
    // No timers needed, just reconstructed state
    log.info({}, `[debate] Recovered paused debate for ${sessionCode}`);
    return;
  }

  if (state.phase === "GRACE") {
    // Grace was interrupted, immediately advance
    log.info({}, `[debate] Recovering from grace period for ${sessionCode}, advancing...`);
    state.turnStartedAt = now;
    await advanceTurn(sessionCode, "TIMER_EXPIRED", io);
    return;
  }

  if (state.phase === "ACTIVE" && row.turn_ends_at) {
    const remainingMs = row.turn_ends_at - now;
    if (remainingMs <= 0) {
      // Timer already expired during downtime, advance immediately
      log.info({}, `[debate] Turn expired during downtime for ${sessionCode}, advancing...`);
      state.turnStartedAt = now - state.turnLength * 1000; // pretend it started long ago
      await advanceTurn(sessionCode, "TIMER_EXPIRED", io);
    } else {
      // Resume with remaining time
      const remainingSec = remainingMs / 1000;
      state.turnStartedAt = now;
      state.pausedTimeRemaining = remainingSec;
      scheduleTimersWithDuration(state, remainingSec, io);
      log.info({}, `[debate] Recovered active debate for ${sessionCode}, ${remainingSec.toFixed(1)}s remaining`);
    }
    return;
  }

  log.info({}, `[debate] Recovered debate for ${sessionCode} in phase ${state.phase}`);
}

/**
 * Load debate state from DB when a client requests it but the server
 * doesn't have it in memory (e.g., server restarted and no one re-joined yet).
 */
export async function getOrLoadState(
  roomCode: string,
  io: SocketIOServer,
): Promise<DebateStatePayload | null> {
  // Check in-memory first
  const memState = getState(roomCode);
  if (memState) return memState;

  // Try to load from DB
  const session = await getSessionByCode(roomCode);
  if (!session) return null;

  const row = await loadDebateState(session.id);
  if (!row || row.phase === "ENDED") return null;

  // Reconstruct in memory
  await recoverDebateFromRow(row, io);
  return getState(roomCode);
}

// ── Private Helpers ──

function getNextIndex(state: InternalDebateState): number {
  const len = state.debaterOrder.length;
  if (len === 0) return 0;

  switch (state.format) {
    case "ONE_ON_ONE":
      return (state.currentIndex + 1) % 2;

    case "PANEL":
      return (state.currentIndex + 1) % len;

    case "EXPERT_VS_CROWD": {
      // Expert is always at index 0
      // If currently expert's turn -> go to challenger (index 1)
      // If currently challenger's turn -> back to expert (index 0)
      // TODO: In follow-up PR, rotate challengers from queue
      if (state.currentIndex === 0) {
        return len > 1 ? 1 : 0;
      }
      return 0;
    }

    case "TEAM": {
      // Two teams alternate. Simple alternation for now.
      // TODO: In follow-up PR, cycle within teams
      return (state.currentIndex + 1) % len;
    }

    default:
      return (state.currentIndex + 1) % len;
  }
}

function scheduleTimers(state: InternalDebateState, io: SocketIOServer): void {
  scheduleTimersWithDuration(state, state.turnLength, io);
}

function scheduleTimersWithDuration(
  state: InternalDebateState,
  durationSec: number,
  io: SocketIOServer,
): void {
  clearAllTimers(state);

  const durationMs = durationSec * 1000;

  // Turn expiry timer -> starts grace period
  state.turnTimer = setTimeout(() => {
    onTurnExpired(state, io);
  }, durationMs);

  // Warning timers
  for (const threshold of WARNING_THRESHOLDS) {
    if (durationSec > threshold) {
      const delay = (durationSec - threshold) * 1000;
      const timer = setTimeout(() => {
        const payload: TurnWarningPayload = {
          secondsRemaining: threshold,
        };
        io.to(state.roomCode).emit("turnWarning", payload);
      }, delay);
      state.warningTimers.push(timer);
    }
  }
}

function onTurnExpired(
  state: InternalDebateState,
  io: SocketIOServer,
): void {
  // Enter grace phase
  state.phase = "GRACE";

  // Mute the expired speaker
  const expiredSpeaker = state.debaterOrder[state.currentIndex];
  if (expiredSpeaker) {
    muteDebater(state.roomCode, expiredSpeaker.userId, io);
  }

  // Notify clients of grace period
  const payload: TurnExpiringPayload = {
    version: state.version,
    expiredUserId: expiredSpeaker?.userId ?? "",
  };
  io.to(state.roomCode).emit("turnExpiring", payload);

  // Grace timer -> auto-advance
  state.graceTimer = setTimeout(() => {
    advanceTurn(state.roomCode, "TIMER_EXPIRED", io).catch((err) => {
      log.error({ err }, "[debate] Auto-advance failed");
    });
  }, GRACE_PERIOD_MS);
}

function clearAllTimers(state: InternalDebateState): void {
  if (state.turnTimer) {
    clearTimeout(state.turnTimer);
    state.turnTimer = null;
  }
  if (state.graceTimer) {
    clearTimeout(state.graceTimer);
    state.graceTimer = null;
  }
  for (const t of state.warningTimers) {
    clearTimeout(t);
  }
  state.warningTimers = [];
}

async function persistState(state: InternalDebateState): Promise<void> {
  try {
    const turnEndsAt = state.turnStartedAt
      ? state.turnStartedAt + state.turnLength * 1000
      : null;

    await persistDebateState({
      id: state.id,
      sessionId: state.sessionId,
      debaterOrder: state.debaterOrder,
      currentIndex: state.currentIndex,
      turnLength: state.turnLength,
      turnEndsAt,
      isPaused: state.isPaused,
      pausedTimeRemaining: state.pausedTimeRemaining,
      format: state.format,
      formatMeta: state.formatMeta,
      phase: state.phase,
      version: state.version,
    });
  } catch (err) {
    log.error({ err }, "[debate] Failed to persist state");
  }
}

// ── Mute/Unmute via mediasoup ──

function muteDebater(
  roomCode: string,
  userId: string | undefined,
  io: SocketIOServer,
): void {
  if (!userId) return;

  // Server-side: pause audio producer via mediasoup
  const room = getRoom(roomCode);
  if (room) {
    for (const peer of room.peers.values()) {
      if (peer.userId === userId) {
        for (const producer of peer.producers.values()) {
          if (producer.kind === "audio") {
            producer.pause().catch(() => {});
          }
        }
        break;
      }
    }
  }

  // Client-side: send forceMute event
  io.to(roomCode).emit("forceMute", { userId });
}

function unmuteDebater(
  roomCode: string,
  userId: string | undefined,
  io: SocketIOServer,
): void {
  if (!userId) return;

  // Server-side: resume audio producer via mediasoup
  const room = getRoom(roomCode);
  if (room) {
    for (const peer of room.peers.values()) {
      if (peer.userId === userId) {
        for (const producer of peer.producers.values()) {
          if (producer.kind === "audio") {
            producer.resume().catch(() => {});
          }
        }
        break;
      }
    }
  }

  // Client-side: send forceUnmute event
  io.to(roomCode).emit("forceUnmute", { userId });
}
