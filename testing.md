## Overview

Arguably is verified at three layers:

1. **Unit / mock tests** — Vitest, located in `__tests__/` (excluding the SFU subfolders)
2. **End-to-end tests** — Playwright, located in `tests/`
3. **Real-time SFU tests** — Vitest with simulated Socket.IO clients, located in `__tests__/sfu/`, `__tests__/realtime/`, and `__tests__/security/auth.test.ts`, run with a dedicated config (`vitest.sfu.config.ts`)

All three layers also run automatically on every push and pull request via GitHub Actions (`.github/workflows/unit-tests.yml`, `e2e-tests.yml`, `sfu-tests.yml`).

## Where the tests live

| Location | Purpose | Runner |
|----------|---------|--------|
| `__tests__/` (excluding `sfu/`, `realtime/`, `security/auth.test.ts`) | Unit and integration tests for the Next.js app — server actions, hooks, helpers, UI components, mocked Prisma/Supabase | Vitest (`vitest.config.ts`) |
| `__tests__/sfu/`, `__tests__/realtime/`, `__tests__/security/auth.test.ts` | Unit tests for the SFU — auth, validation, debate engine, signaling helpers | Vitest (`vitest.sfu.config.ts`) |
| `tests/` | End-to-end browser tests — auth flow, room creation, browse page, joining a live debate | Playwright (`playwright.config.ts`) |
| `playwright-report/` | HTML report from the most recent Playwright run | — |

## What is covered

**Unit / integration (Vitest):**
- Server Actions in `lib/actions/` (session creation, role transitions, profile upsert) with a mocked Prisma client
- Authentication helpers and Supabase client initialization
- Custom hooks (`useDebateState`, `useMediasoup`) under controlled state
- UI components in `components/ui/` rendered with `@testing-library/react`

**Realtime SFU (Vitest):**
- Supabase JWT verification in `realtime/src/auth.ts`
- Zod input validation in `realtime/src/validation.ts`
- Debate Flow Engine state machine in `realtime/src/debate.ts` — turn advancement, pause/resume, queue ordering
- Socket.IO event handler logic with mocked sockets

**End-to-end (Playwright):**
- Sign-up and sign-in flows against a real Supabase project
- Room creation wizard for all four debate formats
- Browse page filtering and joining a session
- Two-client smoke test for the realtime room (peer joins, video producer registers)

## How to run the tests

Prerequisites:
- Node.js 20+
- Repository installed per the README "Setup Steps" section (`npm install`, `.env` filled in, `npx prisma db push` run against a Supabase database)
- For E2E tests: `TEST_USER_EMAIL` and `TEST_USER_PASSWORD` set in `.env` and the matching user already created in Supabase Auth

Commands (from the project root):

```bash
npm run test:unit       # Vitest unit + integration suite for the Next.js app
npm run test:sfu        # Vitest suite for the realtime SFU (uses vitest.sfu.config.ts)
npm run test:e2e        # Playwright end-to-end suite (alias: npm run test)
npx playwright show-report   # open the HTML report after an E2E run
```

The Playwright config auto-starts `next dev` on port 3000 (see `playwright.config.ts`), so you do not need a separate dev server for E2E. The realtime SFU is **not** auto-started by Playwright — start it with `npm run realtime:dev` in a second terminal before running specs that exercise live debate features.

Playwright runs in two projects:

- `public` — auth and browse pages, no login required
- `setup` + `authenticated` — logs in once via `tests/auth.setup.ts`, then runs all room/session specs against the persisted storage state

To run only one project: `npx playwright test --project=public`.

## Important limitations

- **E2E tests require a live Supabase project.** They sign in with real credentials and write rows to your database. Use a throwaway Supabase project for CI; do not point them at production data.
- **The realtime SFU is not started by Playwright or by CI.** Specs that join a room will fail to establish video/audio unless `npm run realtime:dev` (or `npm run realtime:docker:up`) is running locally. The current CI workflow runs only the public + authenticated browser specs and does not boot the SFU, so peer-to-peer media is not regression-tested in CI.
- **Mediasoup audio/video streams are not asserted byte-for-byte.** Tests verify that the producer/consumer signaling round-trips and that the peer appears in the room; perceptual media quality is verified manually.
- **Live transcription and AI claim detection are not exercised in tests.** They depend on external paid APIs (OpenAI, Gemini) and are stubbed out in unit tests.
- **Authenticated E2E jobs need extra secrets.** Pull requests from forks will see those steps skipped because `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` are not exposed to fork workflows.

## CI

Three workflows under `.github/workflows/` run on every push and PR to `master`:

- `unit-tests.yml` — runs `npm run test:unit`
- `sfu-tests.yml` — runs `npm run test:sfu`
- `e2e-tests.yml` — installs Playwright browsers, runs the `public` project, then runs `setup` + `authenticated` if the test-user secrets are available

Failing checks block merges. The Playwright HTML report is uploaded as a workflow artifact for every E2E run, passing or failing.
