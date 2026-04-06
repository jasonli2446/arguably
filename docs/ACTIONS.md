The following documents the use of Service Layer architecture in Arguably.  These server-side codes in `lib/actions/` are written in adherence to event-driven design.

# `lib/action/session.ts` Documentation

## Overview
Server-side actions for managing debate sessions:
- Create sessions
- Query sessions
- Join / leave sessions
- Role management (host, moderator, debater, audience)
- Session lifecycle updates

---

## createSession(formData)

**Description**  
Creates a new session and assigns the creator as `HOST`.

**Params**
- `name: string` (required)
- `description?: string`
- `type: SessionType`
- `debaterCapacityProponent: number | null`
- `debaterCapacityOpponent: number | null`
- `debaterCapacityPanel: number | null`
- `audienceCapacity: number`
- `turnLength: number`

**Logic**
- Auth check (Supabase)
- Validate:
  - Non-empty name
  - Non-negative capacities
  - `turnLength >= 1`
- PANEL rules:
  - `debaterCapacityPanel >= 2`
  - Proponent/Opponent must be `null`
- Non-PANEL rules:
  - Proponent ≥ 1
  - Opponent ≥ 0
  - Panel must be `null`
- Generate unique session code (max 10 attempts)
- Create session (Prisma)
- Auto-create host participation

**Side Effects**
- Redirect → `/room/{code}`

**Errors**
- Not authenticated
- Invalid input
- Code generation failure

---

## getSessionsByFilters(filters?)

**Description**  
Fetch sessions with optional filters.

**Params**
- `search?: string`
- `types?: SessionType[]`
- `statuses?: SessionStatus[]`

**Logic**
- Default statuses: `WAITING | LIVE | PAUSED`
- Default types: all
- Case-insensitive name search
- Includes:
  - host
  - moderator
  - active participant count

**Returns**
- `Session[]`

---

## getSessionByCode(code)

**Description**  
Fetch a session by its room code.

**Params**
- `code: string`

**Includes**
- host
- moderator
- active participants (`left_at = null`)
- participant user info

**Returns**
- `Session | null`

---

## joinSession(sessionId)

**Description**  
Join as `AUDIENCE`.

**Logic**
- Auth check
- Ensure:
  - session exists
  - not `ENDED`
  - capacity not exceeded
- Rejoin:
  - if exists → `left_at = null`
  - else → create record

**Errors**
- Not authenticated
- Session not found
- Session ended
- Session full

---

## joinSessionAsDebater(sessionId, isProponent)

**Description**  
Join as `DEBATER`.

**Params**
- `sessionId: string`
- `isProponent: boolean`

**Logic**
- Auth check
- Ensure:
  - session exists
  - not `ENDED`
- Compute:
  - `totalDebaterCapacity`
  - `totalCapacity`
- Validate:
  - role allowed by session type
  - debater capacity not exceeded
  - total capacity not exceeded
- Rejoin logic:
  - update OR create participation
  - role = `DEBATER`

**Errors**
- Invalid role for session type
- Debater capacity reached
- Session full

---

## leaveSession(sessionId)

**Description**  
Leave session.

**Logic**
- Set `left_at = now`

**Errors**
- Not authenticated

---

## assignModerator(sessionId, targetUserId)

**Description**  
Assign a `MODERATOR`.

**Logic**
- Auth check
- Only `HOST` allowed
- Cannot assign self
- If existing moderator:
  - demote → `AUDIENCE`
- Transaction:
  - update `session.moderator_id`
  - update role → `MODERATOR`

**Errors**
- Not authenticated
- Unauthorized
- Session not found

---

## kickParticipant(sessionId, targetUserId)

**Description**  
Remove participant from session.

**Logic**
- Auth check
- Only `HOST` or `MODERATOR`
- Cannot kick self
- Set `left_at = now`

**Errors**
- Not authenticated
- Unauthorized
- Session not found

---

## updateSessionStatus(sessionId, status)

**Description**  
Update session status.

**Params**
- `status: SessionStatus`

**Logic**
- Auth check
- Only `HOST` or `MODERATOR`
- Update status
- If `ENDED`:
  - set `ended_at`

**Errors**
- Not authenticated
- Unauthorized
- Session not found

---

## Notes
- Capacity checks are global (not per-role granular)
- Rejoin logic reuses existing records
- Consider adding:
  - stricter role-slot validation
  - concurrency-safe capacity enforcement
  - audit logs for moderation actions

---

# `lib/action/debate.ts` Documentation

## Overview
Manages the lifecycle and turn-based logic of a debate session:
- Authorization (moderator/host)
- Debate state retrieval
- Turn control (start, advance, auto-advance)
- Pause / resume
- End debate

---

## requireModerator(sessionId)

**Description**  
Ensures the current user is authorized (HOST or MODERATOR).

**Params**
- `sessionId: string`

**Logic**
- Authenticate user (Supabase)
- Fetch session
- अनुमति if:
  - `user.id === session.host_id`
  - OR `user.id === session.moderator_id`

**Returns**
- `{ user, session }`

**Errors**
- Not authenticated
- Session not found
- Not authorized

---

## getDebateState(sessionId)

**Description**  
Fetch current debate state.

**Params**
- `sessionId: string`

**Returns**
- `null` if no state
- Otherwise:
  - `session_id`
  - `debater_order: { userId, displayName }[]`
  - `current_index`
  - `turn_length`
  - `turn_ends_at`
  - `is_paused`
  - `paused_time_remaining`

---

## startDebate(sessionId, debaters, turnLength)

**Description**  
Initializes or resets a debate.

**Params**
- `sessionId: string`
- `debaters: { userId: string; displayName: string }[]`
- `turnLength: number` (seconds)

**Logic**
- Require moderator/host
- Require exactly 2 debaters
- Set:
  - `current_index = 0`
  - `turn_ends_at = now + turnLength`
  - `is_paused = false`
  - `paused_time_remaining = turnLength`
- Uses `upsert`:
  - Create if not exists
  - Reset if exists

**Errors**
- Unauthorized
- Invalid debater count

---

## advanceTurn(sessionId)

**Description**  
Manually advance to next speaker.

**Logic**
- Require moderator/host
- Ensure state exists
- Rotate:
  - `current_index = (index + 1) % 2`
- Reset timer:
  - `turn_ends_at = now + turn_length`
  - `paused_time_remaining = turn_length`
  - `is_paused = false`

**Errors**
- Unauthorized
- No active debate

---

## advanceTurnIfExpired(sessionId)

**Description**  
Auto-advances turn when timer expires (safe against race conditions).

**Logic**
- Auth check (silent fail if not logged in)
- Fetch state
- Exit if:
  - no state
  - paused
  - no timer
  - timer not expired (with ~1s buffer)
- Atomic update using `updateMany`:
  - only updates if `current_index` unchanged
- Advances turn + resets timer

**Notes**
- Prevents double-advance via optimistic concurrency guard

---

## pauseDebate(sessionId)

**Description**  
Pauses the debate timer.

**Logic**
- Require moderator/host
- Ensure:
  - state exists
  - not already paused
- Compute remaining time:
  - `(turn_ends_at - now)`
- Update:
  - `is_paused = true`
  - `turn_ends_at = null`
  - `paused_time_remaining = remaining`

**Errors**
- Unauthorized
- No active debate
- Already paused

---

## resumeDebate(sessionId)

**Description**  
Resumes a paused debate.

**Logic**
- Require moderator/host
- Ensure:
  - state exists
  - currently paused
- Restore timer:
  - `turn_ends_at = now + paused_time_remaining`
  - `is_paused = false`

**Errors**
- Unauthorized
- No active debate
- Not paused

---

## endDebate(sessionId)

**Description**  
Ends the debate and clears state.

**Logic**
- Require moderator/host
- Delete `debateState`
- Silently ignore if already deleted

---

## Notes
- Currently supports **2 debaters only**
- Turn rotation is strictly alternating (`% 2`)
- Uses server time (`Date.now()`) → ensure consistency across clients
- `advanceTurnIfExpired` is concurrency-safe via conditional update
- Pause/resume preserves exact remaining time

### Potential Improvements
- Support >2 debaters
- Add per-speaker time tracking
- Persist debate history (rounds, transcripts)
- Add event logs for moderation actions
- Use DB-level time (`NOW()`) for stronger consistency

---

# lib/action/user.ts Documentation

## Overview
Handles user profile initialization and synchronization with the database.

- Ensures authenticated users have a corresponding DB record
- Generates a unique username
- Prevents race conditions with `upsert`

---

## ensureUserProfile()

**Description**  
Ensures the currently authenticated user has a profile in the database.  
Creates one if it does not exist.

---

**Flow**
1. Authenticate user via Supabase
2. If no user → return `null`
3. Derive username:
   - Use email prefix (`before @`)
   - Fallback → `user-{id.slice(0, 8)}`
4. Resolve username collisions:
   - Check if username exists
   - If taken:
     - If owned by same user → reuse
     - Else → append suffix (`-1`, `-2`, ...)
5. Persist user using `upsert`:
   - Avoids duplicate creation during concurrent requests

---

**Returns**
- `User` object (from database)
- `null` if not authenticated

---

**Key Behaviors**
- **Idempotent**: Safe to call multiple times
- **Collision-safe**: Guarantees unique usernames
- **Race-condition safe**: Uses Prisma `upsert`
- **Deterministic fallback**: Always produces a valid username

---

**Username Rules**
- Primary: email prefix  
  - Example: `john@example.com` → `john`
- Fallback:
  - `user-<first 8 chars of user.id>`
- Collision handling:
  - `john` → `john-1` → `john-2` → ...

---

**Edge Cases**
- Missing email → fallback username used
- Multiple concurrent requests → handled by `upsert`
- Username already owned by same user → no duplication
- High collision scenarios → incremental suffix ensures uniqueness

---

**Potential Improvements**
- Enforce username format validation (length, characters)
- Add reserved usernames (e.g., `admin`, `system`)
- Cache username availability checks
- Move collision handling to DB-level unique constraints + retry
- Allow user-defined usernames (with validation layer)