import "dotenv/config";
import pg from "pg";

// Use raw pg for the realtime server's few DB queries.
// This avoids the complexity of sharing the Prisma generated client across packages
// while keeping queries simple and type-safe via explicit interfaces.

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

// ── Types mirroring Prisma schema ──

export interface DbDebateState {
  id: string;
  session_id: string;
  debater_order: unknown; // JSON
  current_index: number;
  turn_length: number;
  turn_ends_at: number | null;
  is_paused: boolean;
  paused_time_remaining: number;
  format: string;
  format_meta: unknown | null;
  phase: string;
  version: number;
}

export interface DbSession {
  id: string;
  code: string;
  type: string;
  host_id: string;
  moderator_id: string | null;
}

// ── Queries ──

export async function persistDebateState(state: {
  id: string;
  sessionId: string;
  debaterOrder: unknown;
  currentIndex: number;
  turnLength: number;
  turnEndsAt: number | null;
  isPaused: boolean;
  pausedTimeRemaining: number;
  format: string;
  formatMeta: unknown | null;
  phase: string;
  version: number;
}): Promise<void> {
  await pool.query(
    `INSERT INTO "DebateState" (
      id, session_id, debater_order, current_index, turn_length,
      turn_ends_at, is_paused, paused_time_remaining, format, format_meta, phase, version
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (session_id) DO UPDATE SET
      debater_order = $3, current_index = $4, turn_length = $5,
      turn_ends_at = $6, is_paused = $7, paused_time_remaining = $8,
      format = $9, format_meta = $10, phase = $11, version = $12`,
    [
      state.id,
      state.sessionId,
      JSON.stringify(state.debaterOrder),
      state.currentIndex,
      state.turnLength,
      state.turnEndsAt,
      state.isPaused,
      state.pausedTimeRemaining,
      state.format,
      state.formatMeta ? JSON.stringify(state.formatMeta) : null,
      state.phase,
      state.version,
    ],
  );
}

export async function loadDebateState(
  sessionId: string,
): Promise<DbDebateState | null> {
  const { rows } = await pool.query(
    `SELECT * FROM "DebateState" WHERE session_id = $1`,
    [sessionId],
  );
  return rows[0] ?? null;
}

export async function loadAllActiveDebates(): Promise<DbDebateState[]> {
  const { rows } = await pool.query(
    `SELECT * FROM "DebateState" WHERE phase != 'ENDED'`,
  );
  return rows;
}

export async function logTurnTransition(entry: {
  debateStateId: string;
  speakerUserId: string | null;
  speakerName: string;
  turnIndex: number;
  reason: string;
  startedAt: Date;
  endedAt: Date;
  durationSec: number;
}): Promise<void> {
  const id = generateCuid();
  await pool.query(
    `INSERT INTO "TurnLog" (
      id, debate_state_id, speaker_user_id, speaker_name,
      turn_index, reason, started_at, ended_at, duration_sec
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      entry.debateStateId,
      entry.speakerUserId,
      entry.speakerName,
      entry.turnIndex,
      entry.reason,
      entry.startedAt,
      entry.endedAt,
      entry.durationSec,
    ],
  );
}

export async function deleteDebateState(sessionId: string): Promise<void> {
  await pool.query(`DELETE FROM "DebateState" WHERE session_id = $1`, [
    sessionId,
  ]);
}

export async function getSessionByCode(
  code: string,
): Promise<DbSession | null> {
  const { rows } = await pool.query(
    `SELECT id, code, type, host_id, moderator_id FROM "Session" WHERE code = $1`,
    [code],
  );
  return rows[0] ?? null;
}

export async function filterActiveDebaterIds(
  sessionId: string,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT user_id FROM "ParticipatesIn"
     WHERE session_id = $1 AND user_id = ANY($2::uuid[]) AND left_at IS NULL`,
    [sessionId, userIds],
  );
  return rows.map((r: { user_id: string }) => r.user_id);
}

export async function getSessionCodeById(
  sessionId: string,
): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT code FROM "Session" WHERE id = $1`,
    [sessionId],
  );
  return rows[0]?.code ?? null;
}

export async function isHostOrModerator(
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT id FROM "Session"
     WHERE id = $1 AND (host_id = $2 OR moderator_id = $2)`,
    [sessionId, userId],
  );
  return rows.length > 0;
}

export async function markParticipantLeft(
  sessionId: string,
  userId: string,
): Promise<void> {
  await pool.query(
    `UPDATE "ParticipatesIn"
     SET left_at = NOW()
     WHERE session_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [sessionId, userId],
  );
}

export async function removeFromAudienceQueue(
  sessionId: string,
  userId: string,
): Promise<void> {
  await pool.query(
    `DELETE FROM "AudienceQueue"
     WHERE session_id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
}

// Simple CUID-like ID generator (good enough for turn logs)
function generateCuid(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `c${timestamp}${random}`;
}
