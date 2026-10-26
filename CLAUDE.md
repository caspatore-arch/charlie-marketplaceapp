# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

Dibbs: iPhone-first campus secondhand marketplace. Expo app + Hono/tRPC backend
in one repo. Payments, email and SMS are simulated by default.

# Keeping token use low (owner directive, 2026-10-21)

Subagents: always set `model` to the cheapest one that does the job well.
- **haiku**: searches, reading/summarizing, lint, re-running tests or typecheck, mechanical edits.
- **sonnet**: normal feature and UI work, scripted tests, browser clicking, docs.
- **opus**: only API contracts, auth/payments/data-integrity code, tricky debugging,
  security review, and the coordinator's final verification.
If a cheaper agent's output fails verification, retry once one tier up.
Sessions themselves run on Sonnet unless the owner picks otherwise; keep the main
conversation lean and hand big reads, test runs and mechanical edits to subagents.

# Working alongside other sessions (owner directive, 2026-10-22)

Several sessions share this checkout and its git index. The coordinator is the
session titled "Dibbs page-by-page overhaul" (it may show as "New session"):
- Before editing files another session may be using, run `git status --short`.
  If anything you'd touch already has someone else's uncommitted changes,
  message the coordinator first.
- Don't commit, stage, stash, reset or check out in the shared checkout unless
  the coordinator agrees. Work that can't wait goes in its own worktree and branch.
- Keep `docs/OVERHAUL.md` decisions intact; the coordinator records owner decisions there.

Reading:
- `docs/CONTRACT.md` is large; grep for the section you need instead of reading it whole.
- UI overhaul: `docs/OVERHAUL.md` is the page-by-page checklist with owner decisions
  under "Your call". Read only the group being worked on. Refresh screenshots with
  `node scripts/screenshots.mjs` (backend + web running).
- Read other docs only when the task touches them: `DEPLOY.md` / `DEPLOY-WEB.md`
  (how production is hosted and operated: Render, Neon, Netlify, R2, Resend),
  `DESIGN.md` + `constants/theme.ts` (UI), `APP-STORE.md`, `LEGAL-TODO.md`.
- `HANDOFF.md` (sections 3, 3a, 7: what is simulated, turning payments on) and
  `AUCTIONS.md` (sections 2 and 3: custom meetup addresses and payments; section 1
  auctions is retired) are still cited by code and legal docs. Read only those
  sections, and only when touching payments, addresses or the legal copy.
  The old workstream and publish prompts were deleted.
- Never browse `dist/`, `output/`, `.codex-deck-build/`, `backend/data/`, `.claude/worktrees/`.
- Run `npm run typecheck` and the relevant `test:*` script rather than reading
  code to confirm something works.

# Commands

```bash
npm install && npm run db:seed   # tables + demo data (idempotent)
npm run env:lan                  # point the app at this Mac's LAN IP
npm run backend                  # API on :3000, health at /api/health
npm start                        # Expo; demo path is Expo Go on a real iPhone
npm run web                      # same app in a browser
npm run typecheck && npm run lint
npm run db:reset                 # wipe local PGlite and reseed (stop the backend first)
npm run db:check                 # verify a hosted DATABASE_URL
```

No test runner: each test is a `tsx` script. `test:e2e` (acceptance flow, boots
the server in-process; `E2E_URL` targets a running one), `test:workstreams`
(offers, booking, community, sign-in, SMS), `test:payments` (fake Stripe
gateway), `test:geo`, `test:save`, `loadtest`. Scripts use a throwaway
`PGLITE_DIR`; they set env first and then `await import(...)` backend modules.
Keep that order in new scripts, or a hoisted import opens the demo DB.

No Xcode or Docker on this machine.

# Architecture

- **Rork layout**: the founder publishes through Rork, so keep its structure
  (`app/`, `backend/hono.ts`, `backend/trpc/`, `lib/trpc.ts`,
  `EXPO_PUBLIC_RORK_API_BASE_URL`).
- **Client**: expo-router routes in `app/` (tabs: Browse, Sell, Community,
  Profile; `app/concepts/` is design concepts, not product). `lib/trpc.ts` is
  the one tRPC client and imports `type AppRouter` from the backend, so
  procedure changes are type-checked against screens. Media paths come back
  relative; render through `resolveMediaUrl`.
- **Server**: `backend/hono.ts` mounts `/api/trpc/*`, uploads, Stripe webhook,
  health and `/admin` (off unless `ADMIN_PASSWORD` ≥16 chars). Routers in
  `backend/trpc/routes/*`, joined in `app-router.ts`. Access levels in
  `backend/trpc/trpc.ts`: public, protected, moderator, `campusVerifiedProcedure`
  (required for selling, offers, booking, posting).
- **Database**: Drizzle + Postgres SQL. PGlite on disk when `DATABASE_URL` is
  empty, node-postgres when set. Schema `backend/db/schema.ts`; SQL migrations in
  `backend/db/migrations/` (drizzle-kit) run on server start and seed.
- **Adapters** default to simulated; live modes need several env vars, often a
  `*_LIVE_ACK=1`: `backend/stripe/` (fake vs real, direct charges on Connect),
  `backend/email/` (Resend), `backend/sms/` (outbox + Twilio), `backend/storage.ts`
  (disk vs S3), `backend/geocode.ts`. `.env.example` lists every variable.

# Rules the code must keep

- Server enforces auth, ownership, reservation transitions and conversation
  access (rules in `docs/CONTRACT.md`).
- Phone verified ≠ campus email verified ≠ identity verified; copy names the exact check.
- Demo data and simulated payments are labeled; never imply payment protection.
- No auctions: asking price plus offers. `routes/bid.ts` only answers stale clients.
- Only `EXPO_PUBLIC_*` values reach the app, baked in at build time.
