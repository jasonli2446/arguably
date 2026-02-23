import type { Server as SocketIOServer } from "socket.io";
import type { DebateParticipant, DebateState } from "./types.js";

interface InternalDebateState {
  debaterOrder: DebateParticipant[];
  currentIndex: number;
  turnLength: number;
  turnStartedAt: number | null;
  isPaused: boolean;
  pausedTimeRemaining: number;
  timer: ReturnType<typeof setTimeout> | null;
  lastAdvanceAt: number;
}

const debates = new Map<string, InternalDebateState>();

export function startDebate(
  roomId: string,
  debaters: DebateParticipant[],
  turnLength: number,
  io: SocketIOServer,
): { success: boolean; error?: string } {
  if (debaters.length !== 2) {
    return { success: false, error: "Exactly 2 debaters are required for one-on-one" };
  }

  // Clean up any existing debate for this room
  const existing = debates.get(roomId);
  if (existing?.timer) clearTimeout(existing.timer);

  const now = Date.now();
  const state: InternalDebateState = {
    debaterOrder: debaters,
    currentIndex: 0,
    turnLength,
    turnStartedAt: now,
    isPaused: false,
    pausedTimeRemaining: turnLength,
    timer: null,
    lastAdvanceAt: 0,
  };

  // Start auto-advance timer
  state.timer = setTimeout(() => advanceTurn(roomId, io), turnLength * 1000);

  debates.set(roomId, state);

  io.to(roomId).emit("turnChanged", {
    currentSpeaker: debaters[0],
    turnStartedAt: now,
    turnLength,
    currentIndex: 0,
  });

  return { success: true };
}

export function advanceTurn(
  roomId: string,
  io: SocketIOServer,
): { success: boolean; error?: string } {
  const state = debates.get(roomId);
  if (!state) return { success: false, error: "No active debate in this room" };

  // Debounce: ignore if last advance was < 500ms ago
  const now = Date.now();
  if (now - state.lastAdvanceAt < 500) {
    return { success: false, error: "Too fast, please wait" };
  }

  if (state.timer) clearTimeout(state.timer);

  state.currentIndex = (state.currentIndex + 1) % 2;
  state.turnStartedAt = now;
  state.isPaused = false;
  state.pausedTimeRemaining = state.turnLength;
  state.lastAdvanceAt = now;

  state.timer = setTimeout(() => advanceTurn(roomId, io), state.turnLength * 1000);

  io.to(roomId).emit("turnChanged", {
    currentSpeaker: state.debaterOrder[state.currentIndex],
    turnStartedAt: now,
    turnLength: state.turnLength,
    currentIndex: state.currentIndex,
  });

  return { success: true };
}

export function pauseDebate(
  roomId: string,
  io: SocketIOServer,
): { success: boolean; error?: string } {
  const state = debates.get(roomId);
  if (!state) return { success: false, error: "No active debate in this room" };
  if (state.isPaused) return { success: false, error: "Debate is already paused" };

  if (state.timer) clearTimeout(state.timer);
  state.timer = null;

  const elapsed = (Date.now() - (state.turnStartedAt ?? Date.now())) / 1000;
  state.pausedTimeRemaining = Math.max(0, state.turnLength - elapsed);
  state.isPaused = true;
  state.turnStartedAt = null;

  io.to(roomId).emit("debatePaused", {
    timeRemaining: state.pausedTimeRemaining,
  });

  return { success: true };
}

export function resumeDebate(
  roomId: string,
  io: SocketIOServer,
): { success: boolean; error?: string } {
  const state = debates.get(roomId);
  if (!state) return { success: false, error: "No active debate in this room" };
  if (!state.isPaused) return { success: false, error: "Debate is not paused" };

  const now = Date.now();
  state.turnStartedAt = now;
  state.isPaused = false;

  // Resume timer with remaining time
  const remaining = state.pausedTimeRemaining;
  state.timer = setTimeout(() => advanceTurn(roomId, io), remaining * 1000);

  io.to(roomId).emit("debateResumed", {
    turnStartedAt: now,
    turnLength: remaining,
  });

  return { success: true };
}

export function endDebate(
  roomId: string,
  io: SocketIOServer,
): { success: boolean; error?: string } {
  const state = debates.get(roomId);
  if (!state) return { success: false, error: "No active debate in this room" };

  if (state.timer) clearTimeout(state.timer);
  debates.delete(roomId);

  io.to(roomId).emit("debateEnded", {});

  return { success: true };
}

export function getDebateState(roomId: string): DebateState | null {
  const state = debates.get(roomId);
  if (!state) return null;

  return {
    debaterOrder: state.debaterOrder,
    currentIndex: state.currentIndex,
    turnLength: state.turnLength,
    turnStartedAt: state.turnStartedAt,
    isPaused: state.isPaused,
    pausedTimeRemaining: state.pausedTimeRemaining,
  };
}

// Map socket IDs to user IDs for disconnect handling
const socketUserMap = new Map<string, { userId: string; roomId: string }>();

export function registerDebaterSocket(
  socketId: string,
  userId: string,
  roomId: string,
): void {
  socketUserMap.set(socketId, { userId, roomId });
}

export function handleDebaterDisconnect(
  socketId: string,
  io: SocketIOServer,
): void {
  const mapping = socketUserMap.get(socketId);
  if (!mapping) return;

  socketUserMap.delete(socketId);

  const state = debates.get(mapping.roomId);
  if (!state) return;

  // Check if the disconnected user is the current speaker
  const currentSpeaker = state.debaterOrder[state.currentIndex];
  if (currentSpeaker.userId === mapping.userId) {
    advanceTurn(mapping.roomId, io);
  }
}
