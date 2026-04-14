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

# `lib/action/utils.ts` Documentation

## Overview
Shared utility functions for authentication and authorization checks across server actions.

---

## requireAuth()

**Description**
Require authenticated user. Returns the Supabase user object.

**Logic**
- Fetch current user from Supabase
- Throw error if not authenticated

**Returns**
- Supabase `User` object

**Errors**
- Not authenticated

---

## requireHostOrModerator(sessionId)

**Description**
Require that the current user is the host or moderator of the given session.

**Params**
- `sessionId: string`

**Logic**
- Authenticate user
- Fetch session
- Verify user is either host or moderator

**Returns**
- `{ user, session }` - Both user and session objects

**Errors**
- Not authenticated
- Session not found
- Not authorized

---

## requireParticipant(sessionId)

**Description**
Verify that the authenticated user is an active participant in the session.

**Params**
- `sessionId: string`

**Logic**
- Authenticate user
- Fetch participation record
- Verify user is in session and `left_at` is null

**Returns**
- Supabase `User` object

**Errors**
- Not authenticated
- Not a participant in this session
- User has left the session

---

# `lib/action/transcript.ts` Documentation

## Overview
Manages transcript segments for live debate transcription (REQ-6).

---

## createTranscriptSegment(sessionId, content, timestamp, duration?, confidence?)

**Description**
Create a new transcript segment for a debate session.

**Params**
- `sessionId: string`
- `content: string` - Transcribed text
- `timestamp: number` - Seconds since debate start
- `duration?: number` - Duration of speech segment (seconds)
- `confidence?: number` - Confidence score (0.0 - 1.0)

**Logic**
- Verify user is an active participant
- Create transcript record with speaker attribution

**Returns**
- `Transcript` object

**Errors**
- Not authenticated
- Not a participant in this session

---

## getTranscriptBySession(sessionId)

**Description**
Fetch all transcript segments for a session in chronological order.

**Params**
- `sessionId: string`

**Logic**
- Verify user is an active participant
- Fetch all segments ordered by timestamp
- Include speaker details (id, username, realname)

**Returns**
- `Transcript[]` with speaker information

**Errors**
- Not authenticated
- Not a participant in this session

---

# `lib/action/recording.ts` Documentation

## Overview
Manages video recordings of completed debate sessions (REQ-8).

---

## createRecording(sessionId, url, duration?, fileSize?, mimeType?)

**Description**
Create a recording entry for a debate session. Only host or moderator can create recordings.

**Params**
- `sessionId: string`
- `url: string` - Recording file URL
- `duration?: number` - Duration in seconds
- `fileSize?: number` - File size in bytes
- `mimeType?: string` - MIME type (e.g., "video/webm")

**Logic**
- Verify user is host or moderator
- Create recording record

**Returns**
- `Recording` object

**Errors**
- Not authenticated
- Not authorized (not host or moderator)
- Session not found

---

## getRecordingsBySession(sessionId)

**Description**
Fetch all recordings for a session, most recent first.

**Params**
- `sessionId: string`

**Logic**
- Verify user is an active participant
- Fetch recordings ordered by creation date (desc)
- Include recorder details

**Returns**
- `Recording[]` with recorder information

**Errors**
- Not authenticated
- Not a participant in this session

---

## deleteRecording(recordingId)

**Description**
Delete a recording. Only the recording creator or session host can delete.

**Params**
- `recordingId: string`

**Logic**
- Authenticate user
- Fetch recording with session host info
- Verify user is either the recorder or the session host
- Delete recording

**Errors**
- Not authenticated
- Recording not found
- Not authorized to delete this recording

---

# `lib/action/vote.ts` Documentation

## Overview
Manages audience voting for kick and promote actions (REQ-4).

---

## castVote(sessionId, targetUserId, voteType)

**Description**
Cast a vote to kick or promote a participant.

**Params**
- `sessionId: string`
- `targetUserId: string`
- `voteType: VoteType` - KICK or PROMOTE

**Logic**
- Authenticate user
- Verify user is not voting for themselves
- Verify session is LIVE
- Verify voter is an active participant
- Upsert vote (idempotent)

**Returns**
- `Vote` object

**Errors**
- Not authenticated
- Cannot vote for yourself
- Session not found
- Session is not live
- Not a participant in this session

**Notes**
- Uses `upsert` to prevent duplicate votes
- Unique constraint: one vote of each type per voter-target pair per session

---

## retractVote(sessionId, targetUserId, voteType)

**Description**
Retract a previously cast vote.

**Params**
- `sessionId: string`
- `targetUserId: string`
- `voteType: VoteType`

**Logic**
- Authenticate user
- Delete the vote record

**Errors**
- Not authenticated
- Vote not found

---

## getVoteCounts(sessionId, targetUserId, voteType)

**Description**
Get the count of votes for a specific target and vote type.

**Params**
- `sessionId: string`
- `targetUserId: string`
- `voteType: VoteType`

**Returns**
- `{ count: number }`

---

# `lib/action/queue.ts` Documentation

## Overview
Manages the FIFO audience queue for promoting speakers (REQ-4).

---

## joinQueue(sessionId)

**Description**
Add the current user to the audience queue.

**Params**
- `sessionId: string`

**Logic**
- Authenticate user
- Verify session is LIVE
- Verify user is an active AUDIENCE member
- Add to queue

**Returns**
- `AudienceQueue` object

**Errors**
- Not authenticated
- Session not found
- Session is not live
- Not a participant in this session
- Only audience members can join the queue

---

## leaveQueue(sessionId)

**Description**
Remove the current user from the audience queue.

**Params**
- `sessionId: string`

**Logic**
- Authenticate user
- Delete queue entry

**Errors**
- Not authenticated
- Queue entry not found

---

## getQueue(sessionId)

**Description**
Fetch the current audience queue in FIFO order.

**Params**
- `sessionId: string`

**Returns**
- `AudienceQueue[]` ordered by `joined_queue` (ascending)
- Includes user details (id, username, realname)

---

## promoteFromQueue(sessionId, userId?)

**Description**
Promote a user from the audience queue to DEBATER. Only host or moderator can promote.

**Params**
- `sessionId: string`
- `userId?: string` - Optional specific user; if omitted, promotes FIFO head

**Logic**
- Verify user is host or moderator
- Transaction:
  - Find queue entry (specific user or FIFO head)
  - Update role to DEBATER
  - Remove from queue
  - Log role transition

**Returns**
- `{ promotedUserId: string }`

**Errors**
- Not authenticated
- Not authorized (not host or moderator)
- Session not found
- No one in the queue

---

# `lib/action/team.ts` Documentation

## Overview
Manages team assignments for TEAM format debates.

---

## assignTeam(sessionId, userId, team)

**Description**
Assign a user to a team. Only host or moderator can assign.

**Params**
- `sessionId: string`
- `userId: string`
- `team: string` - Must be "proponent" or "opponent"

**Logic**
- Verify user is host or moderator
- Verify session type is TEAM
- Verify team value is valid
- Upsert team assignment

**Returns**
- `TeamAssignment` object

**Errors**
- Not authenticated
- Not authorized (not host or moderator)
- Session not found
- Team assignments are only for TEAM format sessions
- Team must be 'proponent' or 'opponent'

---

## getTeamAssignments(sessionId)

**Description**
Fetch all team assignments for a session.

**Params**
- `sessionId: string`

**Returns**
- `TeamAssignment[]` ordered by `assigned_at` (ascending)
- Includes user details (id, username, realname)

---

## removeFromTeam(sessionId, userId)

**Description**
Remove a user from their team. Only host or moderator can remove.

**Params**
- `sessionId: string`
- `userId: string`

**Logic**
- Verify user is host or moderator
- Delete team assignment

**Errors**
- Not authenticated
- Not authorized (not host or moderator)
- Session not found
- Team assignment not found

---

# `lib/action/debate.ts` Documentation

## Overview
Manages the lifecycle and turn-based logic of a debate session:
- Debate state retrieval
- Turn control (start, advance, auto-advance)
- Pause / resume
- End debate

**Note:** This file now uses the shared `requireHostOrModerator` function from `utils.ts` for authorization checks.

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
- Require host/moderator (via `requireHostOrModerator`)
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
- Not authenticated
- Not authorized (not host or moderator)
- Session not found
- Invalid debater count

---

## advanceTurn(sessionId)

**Description**
Manually advance to next speaker.

**Logic**
- Require host/moderator (via `requireHostOrModerator`)
- Ensure state exists
- Rotate:
  - `current_index = (index + 1) % 2`
- Reset timer:
  - `turn_ends_at = now + turn_length`
  - `paused_time_remaining = turn_length`
  - `is_paused = false`

**Errors**
- Not authenticated
- Not authorized (not host or moderator)
- Session not found
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
- Require host/moderator (via `requireHostOrModerator`)
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
- Not authenticated
- Not authorized (not host or moderator)
- Session not found
- No active debate
- Already paused

---

## resumeDebate(sessionId)

**Description**
Resumes a paused debate.

**Logic**
- Require host/moderator (via `requireHostOrModerator`)
- Ensure:
  - state exists
  - currently paused
- Restore timer:
  - `turn_ends_at = now + paused_time_remaining`
  - `is_paused = false`

**Errors**
- Not authenticated
- Not authorized (not host or moderator)
- Session not found
- No active debate
- Not paused

---

## endDebate(sessionId)

**Description**
Ends the debate and clears state.

**Logic**
- Require host/moderator (via `requireHostOrModerator`)
- Delete `debateState`
- Silently ignore if already deleted

**Errors**
- Not authenticated
- Not authorized (not host or moderator)
- Session not found

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

---

## getUserPreferences()

**Description**
Fetch user preferences for the currently authenticated user.

**Logic**
- Authenticate user (via `requireAuth`)
- Fetch user record with all preference fields

**Returns**
- User object containing:
  - `username, email, realname, bio`
  - Notification preferences: `notify_invitations, notify_messages, notify_weekly_digest`
  - Privacy preferences: `profile_visibility, show_online_status, allow_direct_messages`
  - Appearance preferences: `theme, font_size, animations_enabled`
  - Language & region: `language, timezone, date_format`

**Errors**
- Not authenticated

---

## updateUserPreferences(prefs)

**Description**
Update user preferences for the currently authenticated user.

**Params**
- `prefs: UserPreferences` - Object containing preferences to update

**UserPreferences Type:**
```typescript
{
  bio?: string | null
  notify_invitations?: boolean
  notify_messages?: boolean
  notify_weekly_digest?: boolean
  profile_visibility?: string
  show_online_status?: boolean
  allow_direct_messages?: boolean
  theme?: string
  font_size?: string
  animations_enabled?: boolean
  language?: string
  timezone?: string
  date_format?: string
}
```

**Logic**
- Authenticate user (via `requireAuth`)
- Validate constraints:
  - `theme`: must be "dark", "light", or "system"
  - `font_size`: must be "small", "medium", or "large"
  - `profile_visibility`: must be "public" or "private"
- Update user record with provided preferences

**Returns**
- Updated `User` object

**Errors**
- Not authenticated
- Theme must be 'dark', 'light', or 'system'
- Font size must be 'small', 'medium', or 'large'
- Profile visibility must be 'public' or 'private'