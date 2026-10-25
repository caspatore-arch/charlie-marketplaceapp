# Video clips on listings — scope (deferred by the owner, 2026-10-25)

**Status: deferred.** The owner chose to skip videos for now; the five open
questions at the bottom are unanswered. Do not start this without a new request.

Requested by the owner 2026-10-25. Scoping only: no code written, nothing
committed. Per `docs/PROJECT-DIRECTIVES.md` this is not on the work queue until the
owner approves it; the hosted-backend and storage items (queue 4–5) come first
because clips need real hosted storage anyway.

Line numbers below come from the working tree on 2026-10-25. Other sessions had
uncommitted edits in several of these files, so numbers may have moved.

## Plain summary

Let a seller add **one optional short video clip (up to 30 seconds)** to a listing.
Photos stay required and unchanged. Buyers see the clip as an extra page in the
listing's photo gallery, plus a small play badge on the listing card. No clips on
Community text posts, in messages, or live (see "Not in v1").

Recommended path: use **Cloudflare Stream** (a paid video service) so the phone
uploads straight to it and it handles format conversion and streaming. Fallback:
store clips in R2 ourselves — cheaper per month, but about 1–1.5 more days of work
and more format risk. Estimated build: **~3 days plus a half-day spike**, about
**$5–40 a month** at pilot scale (see "Cost").

## Goals and non-goals

- v1: one clip per listing, ≤ 30 s, ≤ 100 MB, added by the listing's seller, who must
  be campus-email verified (`campusVerifiedProcedure`), after the listing exists.
- A clip never replaces a photo. Cover images, cards, story art, share previews and
  "Fill in from photos" keep reading `listing_photos` only.
- Copy never implies a video proves condition, identity or safety.

### Not in v1

Live streaming, clips on Community posts or messages, several clips per listing, video
in the Sell form before the listing exists (v1.1), automatic content scanning,
background upload, captions.

## What exists today (verified in code)

- Upload route `POST /api/uploads` (`backend/hono.ts:180`) accepts JPEG/PNG/WebP/HEIC
  only, 8 MB cap (`MAX_UPLOAD_BYTES`, `backend/storage.ts:22`). It buffers the whole
  file in memory (`Buffer.from(await file.arrayBuffer())`), and no `bodyLimit`
  middleware exists, so an oversize body is parsed before it is rejected.
- `StorageAdapter` has only `put` and `get` (`storage.ts:54`). `get` reads the whole
  object into memory (disk `readFile`, S3 `transformToByteArray`) and
  `GET /api/uploads/:name` replies `200` with the full body. There is no `Range`
  support and no delete method.
- Listing media is `listing_photos` (url, sortOrder, width, height;
  `backend/db/schema.ts:273`); `photoUrls` is 1–8 strings (`routes/listing.ts:111`);
  the cover is `photos[0]` (`backend/trpc/lib.ts:780`, `:883`).
- Client: `uploadImage` fakes progress (0 then 1; `lib/trpc.ts:117`); the Sell picker
  is images-only (`components/sell/PhotoPickerRow.tsx:86`); the gallery is a paged
  `FlatList` of 4:5 photos (`components/PhotoGallery.tsx`).
- Moderation: reports can target a listing; moderators choose `dismiss`,
  `remove_listing` or `note` (`routes/moderation.ts:85`). `remove_listing` sets
  `listings.status = 'removed'` and cancels accepted holds.
- `expo-video` is not installed. Per the SDK 57 docs it is included in Expo Go, so
  clips can be tested on the current Expo Go demo path.

## Decision for the owner: where clips are stored and served

| | A. Cloudflare Stream (recommended) | B. R2 + our own serving |
|---|---|---|
| Phone uploads to | Stream directly, via a one-time URL our backend issues | our `/api/uploads/video`, then R2 |
| Backend handles video bytes | No | Yes: needs streaming upload, `Range` serving, size limits |
| Format conversion (iPhone HEVC to something every browser plays) | Stream does it | We do not; native picker preset only, web is whatever the user picks |
| Length cap enforced | By Stream (`maxDurationSeconds` on the upload link) | Client-side only (web ignores `videoMaxDuration`) |
| Extra engineering vs A | none | about +1 to 1.5 days |
| Ongoing cost | per minute stored and delivered | per GB stored, free egress |
| New paid service | Yes, needs owner approval | No (R2 is already the documented storage choice) |

## Schema change

New table rather than a type flag on `listing_photos`, so everything that reads photos
(cover, cards, story art, AI draft) is untouched.

`listing_videos`: `id` uuid pk; `listing_id` uuid not null, FK cascade, **UNIQUE** (one
clip in v1); `uploader_id` uuid FK users; `provider` text (`stream` | `r2`);
`provider_video_id` text; `playback_url` text, `poster_url` text, both null until ready;
`duration_ms` int; `width`, `height` int; `size_bytes` bigint;
`status` enum `uploading | processing | ready | failed | removed`; `created_at`;
`removed_at`; `removed_by_id` FK users.

- Additive, no backfill. Migration `0017_posts_no_expiry` is another session's
  uncommitted work, so this would be **0018** or later. Generate it with drizzle-kit
  after 0017 lands; do not hand-edit `meta/_journal.json`. Review with the existing
  hosted-migration prechecks.
- Reads: `toListingDetail` (`lib.ts` ~836–911) returns `video: { url, posterUrl,
  durationMs } | null` only when `status = 'ready'`. `toListingCards` adds a cheap
  `hasVideo` flag (one extra `inArray` query next to the photo query at `lib.ts:762`).

## Backend changes (option A)

- `backend/video/` adapter, simulated by default like the other adapters; live mode
  needs its env vars plus a `*_LIVE_ACK=1`.
- tRPC on `listing` (campus-verified, owner-checked via `loadOwnListing`, rate
  limited): `createVideoUpload` (inserts an `uploading` row, returns the one-time
  upload URL), `removeVideo`.
- Provider "ready/failed" arrives by webhook or polling. A webhook route in
  `hono.ts` follows the existing Stripe webhook pattern (raw body, signature check).
- `/api/uploads` stays image-only and unchanged.
- Delete the provider asset when a clip is removed, its listing is removed by a
  moderator, or the seller deletes their account.

Option B instead adds `POST /api/uploads/video`: a `bodyLimit`, allow `video/mp4`,
`video/quicktime`, `video/webm`, a separate 100 MB cap, streamed (not buffered)
upload to storage, `Range` (206) support on `GET /api/uploads/:name` (iOS video
playback generally needs byte ranges; confirm in the spike), video extensions in
`contentTypeForName`, a `delete` on `StorageAdapter`, and `S3_PUBLIC_BASE_URL` set so
clips are served from the bucket, not relayed by the backend.

## Client changes

- `npx expo install expo-video`.
- Picker: `mediaTypes: ['videos']`, `videoMaxDuration: 30`. The docs say it has no
  effect on web and depends on the camera app on Android, so also check
  `asset.duration` and `asset.fileSize` before uploading. `videoExportPreset` (e.g.
  `H264_1280x720`) is iOS-only and marked deprecated in the SDK 57 docs: confirm it
  still works.
- Upload with real progress (XHR or a file-system upload task; the current fake
  progress is not good enough for a 20 MB file) and retry on failure.
- Player: `VideoView` + `useVideoPlayer`. expo-video has no poster prop, so show
  `poster_url` with `expo-image` until `onFirstFrameRender`. Add the clip as the page
  after the cover in `PhotoGallery`; native controls, muted, no autoplay in feeds.
- Entry points: an "Add a video clip" step after posting and on the seller's own
  listing page. Cards get a play badge from `hasVideo`.

## Moderation, safety and privacy

- Moderators must be able to **watch the clip inside the report view** before acting.
  Add a `remove_video` action (clip only, listing stays) next to `remove_listing`.
- Account deletion (`deleteAccount`, `routes/user.ts`) must delete the person's clips
  (faces, voices, backgrounds). Anonymising the account alone is not enough.
- Phone videos can carry GPS metadata. Option A re-encodes (confirm the metadata is
  gone in the spike); option B passthrough would publish it.
- There is no automated content scanning. Owner decision: clip visible immediately
  with report/block, or hidden until a moderator approves (safer, slower, needs
  someone watching the queue; `PROJECT-DIRECTIVES.md` item 8 still lists the
  moderation owner as undecided).
- Update before an App Store submission: `docs/APP-STORE.md` §6 (App Privacy: photos
  and videos), the privacy policy text, and the age-rating answers for user-generated
  content. `constants/legal.ts` and `docs/LEGAL-TODO.md` currently have other
  sessions' uncommitted edits, so coordinate first.

## Cost (prices read from Cloudflare's docs on 2026-10-25; re-check before committing)

Prices: R2 $0.015 per GB-month, first 10 GB free, no egress fees. Stream $5 per month
per 1,000 stored minutes (prepaid in $5 steps) plus $1 per 1,000 delivered minutes.

Assumptions (mine): 20-second clips, about 8 MB each after a 720p export, and clips
deleted after 30 days unless noted.

| Scenario | Stream | R2 |
|---|---|---|
| Pilot: 300 clips/month, 5 views each | about $5.50/mo (100 min stored rounds up to one $5 step, 500 min delivered) | $0 (under the 10 GB free tier) |
| Growth: 3,000 clips/month, 10 views each | about $15/mo, or about $40/mo if clips are kept 6 months | about $2/mo even if kept 6 months |

At pilot scale Stream costs about $66 a year, so the saving from option B is small
next to its extra engineering day and format risk. Without deletion, storage grows forever on either path, so the delete-on-removal
rule above also controls cost.

## Tests and verification

- New `scripts/video-check.ts` (tsx, throwaway `PGLITE_DIR`, set env before dynamic
  imports): ownership, campus-verified gate, one clip per listing, status
  transitions, webhook signature, and the three removal paths (seller, moderator,
  account deletion). A simulated provider keeps it offline.
- Device QA: iPhone clip in Expo Go and in a TestFlight build, Chrome and Safari on
  web, a portrait clip, a 31-second clip, a 120 MB clip, airplane mode mid-upload,
  slow connection, and a clip with GPS metadata.
- Run `npm run typecheck`, `test:workstreams`, `test:e2e` and the new script.

## Plan and effort (estimates)

0. **Spike, half a day:** real Stream test upload; play it on iPhone (Expo Go), Chrome
   and Safari. Confirms web playback (HLS vs MP4), the `Range` question, metadata
   stripping and the webhook. This decides A vs B before anything is built.
1. Backend: schema, adapter, tRPC, webhook, tests, about 1 day.
2. Client: picker, upload progress, player, card badge, about 1 day.
3. Moderation, deletion, legal copy, about 0.5–1 day.
4. QA on devices, about 0.5 day.

Total about 3 days after the spike. Start only after migration 0017 and the
other sessions' edits to `schema.ts`, `listing.ts`, `moderation.ts`, `lib.ts` and
`user.ts` are committed, or work in a separate worktree.

## Open questions for the owner

1. Stream (paid, simpler) or R2 (cheaper, more work)?
2. 30 seconds and 100 MB: right limits?
3. Visible immediately, or hidden until a moderator approves?
4. Who watches the report queue before clips go live?
5. Keep clips after a listing expires, or delete them (cheaper, safer)?
