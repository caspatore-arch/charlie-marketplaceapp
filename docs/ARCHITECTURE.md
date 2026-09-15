# Architecture

Working name: **campus-swap** (placeholder; brand undecided). iPhone-first campus secondhand marketplace. See `docs/BRIEF.md` for the product brief, `docs/CONTRACT.md` for the data model + API contract, `docs/DESIGN.md` for the visual system.

## Stack (Rork-compatible)

The founder builds and publishes through **Rork** (rork.com), so this repo mirrors Rork's generated project layout exactly. Do not introduce a different layout.

| Layer | Choice | Notes |
|---|---|---|
| App | Expo SDK 57, expo-router (file routes in `app/`), TypeScript strict | Expo Go on a real iPhone is the demo path. No Xcode on the dev Mac. |
| Client data | `@tanstack/react-query` + `@trpc/react-query` | Client in `lib/trpc.ts`. |
| Icons / images | `lucide-react-native`, `expo-image`, `expo-image-picker` | |
| Backend | Hono (`backend/hono.ts`) + tRPC v11 (`backend/trpc/`) | Served under `/api/trpc/*`, port 3000. `@hono/node-server` for local. |
| DB | Drizzle ORM, **PostgreSQL SQL**. Local driver = PGlite (Postgres compiled to WASM, persisted in `backend/data/pg/`). | `DATABASE_URL` is a one-variable switch: set it (e.g. to a Neon connection string) and `backend/db/client.ts` uses `drizzle-orm/node-postgres` with a `pg.Pool` instead — same schema, same code elsewhere. Verify a hosted URL with `npm run db:check` (connects, runs migrations, prints the table count) before pointing the app at it. |
| Images | Multipart upload to `POST /api/uploads`, stored on local disk `backend/data/uploads/`, served at `GET /api/uploads/:file` | `backend/storage.ts` is an adapter interface so S3-compatible storage can replace it. |
| Auth | Campus-email code (simulated delivery: code printed to server log) + bearer session token in `expo-secure-store` | Dev-only `auth.devSignIn` for switching between the two seeded test identities. |

## Folder layout

```
app/                      expo-router routes (screens)
  _layout.tsx             providers: QueryClient, tRPC, auth, SafeArea
  (tabs)/                 Browse, Sell, Inbox, Profile
  listing/[id].tsx        item detail
  listing/new.tsx, listing/[id]/edit.tsx
  reservation/[id].tsx    meetup card
  conversation/[id].tsx   messages
  auth/*.tsx              sign-in screens
  user/[id].tsx           public profile
components/               reusable UI (ui/ primitives + feature components)
constants/                theme tokens (colors, spacing, type), campus config
hooks/                    useAuth, useSession, etc.
lib/trpc.ts               tRPC client + React Query provider
types/                    shared TS types (re-exported from backend router types)
utils/                    formatting helpers
backend/
  hono.ts                 Hono app (mount tRPC, uploads, health)
  server.ts               local entry (`npm run backend`)
  trpc/                   create-context.ts, app-router.ts, routes/**
  db/                     schema.ts, client.ts, seed.ts, migrate.ts
  storage.ts              upload adapter
  data/                   gitignored: pg/ and uploads/
docs/                     brief, contract, design, handoff
scripts/                  e2e/acceptance scripts run with tsx
```

## Environment

`.env` (gitignored `.env*.local`; commit `.env.example`):

```
EXPO_PUBLIC_RORK_API_BASE_URL=http://<your-mac-lan-ip>:3000   # phone must reach the Mac on Wi‑Fi
DATABASE_URL=                       # empty = PGlite at backend/data/pg; set = drizzle-orm/node-postgres (verify with `npm run db:check`)
PGSSL=                              # set to "require" to force TLS against a non-localhost DATABASE_URL that isn't auto-detected
DEV_LOGIN=1                         # enables auth.devSignIn; never set in production
ALLOWED_EMAIL_DOMAINS=arizona.edu,demo.campus.test
PORT=3000
MODERATOR_USER_IDS=00000000-0000-4000-8000-000000000001   # comma-separated; who can review reports (defaults to Maya's demo id)
```

## Run

```
npm install
npm run db:seed        # creates tables + demo data (idempotent)
npm run backend        # http://localhost:3000/api/health
npm start              # Expo dev server → scan QR in Expo Go
npm run test:e2e       # scripted acceptance flow against a running backend
```

## Non-negotiables (from the brief)

- Server enforces auth, ownership, reservation transitions, and conversation access. Client never trusts itself.
- No secrets in the app bundle. Only `EXPO_PUBLIC_*` values are exposed.
- Demo data is visibly labeled (`isDemo` on users/listings/spots → "Demo" badge in UI).
- Payments are **simulated and labeled**; nothing implies payment protection or success.
- "Campus email verified" ≠ identity verified. Copy must say the former.
