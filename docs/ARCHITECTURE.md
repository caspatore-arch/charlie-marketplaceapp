# Architecture

Name: **Dibbs** (decided). iPhone-first campus secondhand marketplace. See `docs/BRIEF.md` for the product brief, `docs/CONTRACT.md` for the data model + API contract, `docs/DESIGN.md` for the visual system.

## Stack (Rork-compatible)

The founder builds and publishes through **Rork** (rork.com), so this repo mirrors Rork's generated project layout exactly. Do not introduce a different layout.

| Layer | Choice | Notes |
|---|---|---|
| App | Expo SDK 57, expo-router (file routes in `app/`), TypeScript strict | Expo Go on a real iPhone is the demo path. No Xcode on the dev Mac. |
| Client data | `@tanstack/react-query` + `@trpc/react-query` | Client in `lib/trpc.ts`. |
| Icons / images | `lucide-react-native`, `expo-image`, `expo-image-picker` | |
| Backend | Hono (`backend/hono.ts`) + tRPC v11 (`backend/trpc/`) | Served under `/api/trpc/*`, port 3000. `@hono/node-server` for local. |
| DB | Drizzle ORM, **PostgreSQL SQL**. Local driver = PGlite (Postgres compiled to WASM, persisted in `backend/data/pg/`). | `DATABASE_URL` is a one-variable switch: set it (e.g. to a Neon connection string) and `backend/db/client.ts` uses `drizzle-orm/node-postgres` with a `pg.Pool` instead — same schema, same code elsewhere. Verify a hosted URL with `npm run db:check` (connects, runs migrations, prints the table count) before pointing the app at it. |
| Images | Multipart upload to `POST /api/uploads`, stored locally by default | `backend/storage.ts` is an adapter interface: `LocalDiskStorage` (default, `backend/data/uploads/`, served at `GET /api/uploads/:file`) or `S3Storage` (any S3-compatible provider — AWS S3, Cloudflare R2, Backblaze B2, Wasabi — selected by setting `S3_BUCKET`). See `docs/DEPLOY.md`. |
| Auth | **Email-first until SMS is live, then phone-first**: campus-email code (`backend/email/`, Resend) or phone + SMS code; bearer session token in `expo-secure-store` | **Email-first rule:** `auth.methods` returns `primary: 'email'` until live SMS is configured, then `'phone'` automatically, so the client leads with whatever actually delivers. Both deliveries are **simulated** by default (codes printed to the server log). Live email needs `EMAIL_MODE=live` + `RESEND_API_KEY` + `EMAIL_FROM`; live SMS needs Twilio. See `docs/DEPLOY.md` §0a (email) and §6b (SMS). A phone proves a number only: campus-verified actions (sell, offer, book, post) additionally need a verified campus email. Dev-only `auth.devSignIn` switches between seeded test identities. |
| Transactional SMS | Outbox table + in-process dispatcher (`backend/sms/`) | Three event texts (listing posted, booking confirmed, 30-min reminder). Twilio adapter exists but has never run against a real account. |

## Folder layout

```
app/                      expo-router routes (screens)
  _layout.tsx             providers: QueryClient, tRPC, auth, SafeArea
  (tabs)/                 Browse · Sell · Community · Profile
  inbox.tsx               stack screen "Meetups & messages" (not a tab; reached from listings, meetups, Profile)
  listing/[id].tsx        item detail
  listing/new.tsx, listing/[id]/edit.tsx
  reservation/[id].tsx    meetup card
  conversation/[id].tsx   messages
  auth/*.tsx              sign-in screens (phone primary; auth/email.tsx = campus email)
  concepts/               design-concept screens (not product routes)
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
  sms/                    phone.ts (E.164), provider.ts (simulated/Twilio), outbox.ts (queue + dispatcher)
  email/                  provider.ts (simulated/Resend) for sign-in and campus-verification codes
  auth/                   accounts.ts (phone/email account linking, code hashing)
  notifications/          Expo push (messages, meetups, offers)
  data/                   gitignored: pg/ and uploads/
docs/                     brief, contract, design, handoff
scripts/                  e2e/acceptance scripts run with tsx (see "Run")
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
SMS_MODE=simulated                  # default. "live" ALSO needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM and SMS_LIVE_ACK=1; tests always simulate
```

SMS variables (`SMS_MODE`, `TWILIO_*`, `SMS_LIVE_ACK`, `SMS_DISPATCH_INTERVAL_MS`, `SMS_APP_LINK_BASE`, `RATE_LIMIT_PHONE_*`) are all optional and default to simulated. Deployment-only variables (object storage, CORS, rate limits) are documented in full in **`docs/DEPLOY.md`**, with `.env.example` as the source of truth for every variable name. None of them need to be set for local dev.

## Run

```
npm install
npm run db:seed        # creates tables + demo data (idempotent)
npm run backend        # http://localhost:3000/api/health
npm start              # Expo dev server → scan QR in Expo Go
npm run test:e2e       # scripted acceptance flow against a running backend
npm run test:workstreams  # offers, booking, community, phone sign-in/linking, SMS outbox (server side)
npm run test:payments  # payments with the fake gateway
npm run test:geo       # custom-address geocoding (GEOCODER=stub)
npm run test:save      # saved listings
npm run loadtest       # load script
npm run typecheck
```

## Non-negotiables (from the brief)

- Server enforces auth, ownership, reservation transitions, and conversation access. Client never trusts itself.
- No secrets in the app bundle. Only `EXPO_PUBLIC_*` values are exposed.
- Demo data is visibly labeled (`isDemo` on users/listings/spots → "Demo" badge in UI).
- Payments are **simulated and labeled**; nothing implies payment protection or success.
- **Phone verified ≠ campus email verified ≠ identity verified.** A phone proves control of a number only. Only a verified campus email unlocks selling, offering, booking and posting (`campusVerifiedProcedure`), and even that is never "identity verified". Copy must say exactly which check was done.
- No auctions: price is an asking price plus offers (`docs/CONTRACT.md` "Auctions retired"). Do not build bid, ranking or countdown UI.
- Verification codes are never stored in plain text or logged in production; transactional texts go only to users with a verified, opted-in phone.
