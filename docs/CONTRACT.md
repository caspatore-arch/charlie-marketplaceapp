# Data model + API contract

Everything below is the source of truth for backend and frontend agents. If you must deviate, update this file in the same change.

All ids are `uuid` strings. All timestamps are ISO strings over the wire (`timestamptz` in DB). Money is integer **cents** (`priceCents`).

## Enums

```ts
Category   = 'clothing' | 'shoes' | 'jewelry' | 'accessories' | 'dorm' | 'books' | 'tech' | 'other'
Condition  = 'new' | 'like_new' | 'good' | 'fair'
ListingStatus     = 'active' | 'reserved' | 'sold' | 'expired' | 'removed'
ReservationStatus = 'requested' | 'countered' | 'accepted' | 'declined' | 'cancelled' | 'expired' | 'completed'
ReportReason = 'prohibited_item' | 'scam' | 'harassment' | 'no_show' | 'other'
ReportStatus = 'open' | 'reviewed'
ModerationAction = 'dismiss' | 'remove_listing' | 'note'
```

## Tables (Drizzle, Postgres)

- **campuses**: id, name, slug (unique), emailDomains text[], timezone, isDemo bool
- **users**: id, email (unique, private), displayName, avatarUrl?, campusId → campuses, campusEmailVerifiedAt?, bio?, isDemo, createdAt
- **sessions**: id, userId, tokenHash (unique), expiresAt, createdAt
- **email_codes**: id, email, code, expiresAt, consumedAt?
- **meetup_spots**: id, campusId, name, description (precise meeting description, e.g. "north entrance, by the bike racks"), lat, lng, hoursNote?, isDemo, isActive
- **listings**: id, sellerId, campusId, title, description?, category, condition, priceCents, size?, brand?, status, isSellToday bool, expiresAt?, createdAt, updatedAt, soldAt?
- **listing_photos**: id, listingId, url, sortOrder, width?, height?
- **listing_spots**: listingId, spotId (PK both) — seller's acceptable spots
- **availability_windows**: id, listingId, startsAt, endsAt
- **conversations**: id, listingId, buyerId, sellerId, createdAt, lastMessageAt; unique(listingId, buyerId)
- **messages**: id, conversationId, senderId, body, createdAt
- **conversation_reads**: conversationId, userId (PK both), lastReadAt? — one row per participant per conversation; `null`/missing row means "never read". Kept as its own table (rather than two columns on `conversations`) so "who read what" stays answerable and group threads wouldn't need a second migration.
- **reservations**: id, listingId, buyerId, sellerId, status, spotId, startsAt (agreed/proposed time), proposedById (who made the current proposal), priceCents (agreed price snapshot), handoffCode? (4 digits, set on accept), buyerConfirmedAt?, sellerConfirmedAt?, cancelledById?, cancelReason?, createdAt, updatedAt
  - **partial unique index**: `(listingId) WHERE status = 'accepted'` — DB guarantees one accepted hold per item.
- **handoff_confirmations**: id, reservationId, userId, confirmedAt, method ('code' | 'tap')
- **blocks**: blockerId, blockedId (PK both), createdAt
- **reports**: id, reporterId, targetUserId?, targetListingId?, reason, details?, status ('open' | 'reviewed'), reviewedById?, reviewedAt?, moderatorNote?, createdAt
  - `reviewedById`/`reviewedAt`/`moderatorNote` are set by `moderation.reviewReport`; null until a moderator acts.
- **saved_listings**: userId, listingId (PK both), createdAt

## Reservation state machine (server-enforced, transactional)

```
requested ──(seller accept)──▶ accepted ──(both confirm)──▶ completed
requested ──(seller counter)─▶ countered ──(buyer accept)─▶ accepted
countered ──(buyer counter)──▶ countered (roles flip via proposedById)
requested|countered ──(seller decline)──▶ declined
requested|countered|accepted ──(either cancel)──▶ cancelled
accepted ──(either propose reschedule)──▶ countered   (item stays 'reserved' until resolved)
accepted, startsAt + 2h passed, not completed ──(lazy expiry on read)──▶ expired
```

Effects:
- On **accept** (inside one DB transaction): re-read listing `FOR UPDATE`; require `listing.status = 'active'` (or `'reserved'` by this same reservation when re-accepting a reschedule); set reservation `accepted`, generate `handoffCode`; set listing `reserved`; auto-`declined` every other `requested|countered` reservation on this listing (cancelReason `'item_reserved'`). If the partial unique index throws → return `CONFLICT` "This item was just reserved by someone else."
- On **cancel/decline/expire** of an accepted reservation: listing returns to `active` (unless listing is `expired` by its own `expiresAt`, in which case it stays `expired`; owner can relist).
- On **complete**: both parties confirmed (buyer via tap; seller via entering buyer's 4-digit code, or both tap). Reservation `completed`, listing `sold`, `soldAt` set. **No payment event is created or implied.**
- Requests are allowed only when `listing.status = 'active'`, requester ≠ seller, neither party has blocked the other, and `startsAt` is inside one of the listing's availability windows (or seller counters).
- Listing expiry (`isSellToday` → `expiresAt = createdAt + 24h`): applied lazily by `applyExpiry()` at read time: `active` + past `expiresAt` → `expired`. A `reserved` listing does **not** expire while its accepted reservation is open.

## Auth

- `Authorization: Bearer <token>`. Server hashes token (sha256) and looks up `sessions`.
- Context: `{ db, user: User | null }`. `protectedProcedure` throws `UNAUTHORIZED` if no user.
- Ownership: `listing.update/remove`, photo ops → seller only. `conversation.*`, `reservation.*` → participants only. Otherwise `FORBIDDEN`.
- Blocks: blocked users cannot message/request each other; blocked user's listings hidden from blocker's feed.

## tRPC router (`backend/trpc/app-router.ts`)

Namespaced routers. `P` = protected, `pub` = public. Inputs are zod; outputs are the row shapes above unless noted.

```
auth.requestCode      pub  { email }                → { ok: true, simulated: true }   (code logged to server console; email domain must be in ALLOWED_EMAIL_DOMAINS or a campus's emailDomains)
auth.verifyCode       pub  { email, code, displayName? } → { token, user }   (user includes `campus`, same shape as auth.me)
auth.devSignIn        pub  { userId }               → { token, user }   (only if DEV_LOGIN=1; user includes `campus`)
auth.me               P    –                        → User (with campus)
auth.signOut          P    –                        → { ok }

campus.list           pub  –                        → Campus[]
campus.spots          pub  { campusId }             → MeetupSpot[]

listing.feed          pub  { campusId, q?, category?, minCents?, maxCents?, size?, pickupToday?: boolean, cursor?, limit? }
      q = free-text search (trimmed, 1–80 chars); case-insensitive match over title, brand and description
                                                    → { items: ListingCard[], nextCursor? }
      ListingCard = listing + coverPhotoUrl + seller{ id, displayName, avatarUrl, isDemo, campusEmailVerified } + hasAvailabilityToday
listing.byId          pub  { id }                   → ListingDetail = listing + photos[] + seller + spots[] + availabilityWindows[] + activeReservationId? + viewerRole ('seller'|'buyer'|'guest') + isSaved
listing.bySeller      pub  { sellerId, includeSold? } → ListingCard[]
listing.mine          P    –                        → ListingCard[] (all statuses)
listing.create        P    { title, description?, category, condition, priceCents, size?, brand?, isSellToday, photoUrls: string[] (1–8), spotIds: string[] (1+), windows: {startsAt,endsAt}[] (0+) } → ListingDetail
listing.update        P    { id, ...same fields optional }             → ListingDetail
listing.remove        P    { id }                   → { ok }
listing.relist        P    { id, isSellToday }      → ListingDetail  (expired/removed → active)
listing.toggleSave    P    { id }                   → { saved: boolean }
listing.saved         P    –                        → ListingCard[]

conversation.list     P    –                        → { id, listing: ListingCard, otherUser, lastMessage?, unreadCount }[]
      unreadCount = messages from the other participant newer than the caller's conversation_reads.lastReadAt
      (all of them if the caller has never read this thread).
conversation.open     P    { listingId, buyerId? }  → Conversation  (buyer: creates if none for this listing; seller: buyerId required, opens/creates the thread with that buyer)
conversation.messages P    { conversationId, cursor? } → { items: Message[], nextCursor? }
conversation.send     P    { conversationId, body (1–2000) } → Message
conversation.markRead P    { conversationId }       → { ok: true }   (participants only, FORBIDDEN otherwise; sets the caller's lastReadAt to now)
conversation.unreadTotal pub –                       → { conversations: number, actionableReservations: number }
      One cheap call for the tab badge. `conversations` = number of the caller's conversations with
      unreadCount > 0. `actionableReservations` = reservations where the caller is a participant, status
      is `requested` or `countered`, and `proposedById !== caller` (the ball is in their court). Public
      procedure: returns `{ conversations: 0, actionableReservations: 0 }` for an anonymous caller instead
      of throwing, so the tab bar never needs auth branching.

reservation.request   P    { listingId, spotId, startsAt }    → Reservation
reservation.counter   P    { id, spotId, startsAt, note? }    → Reservation   (either party; sets proposedById)
reservation.accept    P    { id }                            → Reservation   (the party who did NOT propose)
reservation.decline   P    { id }                            → Reservation   (seller)
reservation.cancel    P    { id, reason? }                   → Reservation   (either party)
reservation.byId      P    { id }                            → ReservationDetail = reservation + listing + spot + buyer + seller + handoffCode (buyer only sees it) + directionsUrl
reservation.mine      P    { role?: 'buyer'|'seller' }       → ReservationDetail[]
reservation.forListing P   { listingId }                     → Reservation[] (seller only)
reservation.confirmHandoff P { id, code? }                   → ReservationDetail  (buyer: tap; seller: must pass code)

user.byId             pub  { id }                   → PublicProfile { id, displayName, avatarUrl, campus, campusEmailVerified, isDemo, bio, activeListingCount, memberSince }
user.updateMe         P    { displayName?, avatarUrl?, bio? } → User
user.block            P    { userId }               → { ok }
user.unblock          P    { userId }               → { ok }
user.blocked          P    –                        → PublicProfile[]
user.report           P    { targetUserId?, targetListingId?, reason, details? } → { ok }
user.deleteAccount    P    { confirmText: 'DELETE' }        → { ok: true }   (see "Account closure" below)

payment.quote         pub  { priceCents }           → { priceCents, platformFeeCents, sellerNetCents, feePercent, simulated: true, label: 'Simulated — no money moves' }

moderation.isModerator P   –                        → boolean  (whether ctx.user.id is in MODERATOR_USER_IDS)
moderation.reports    M    { status?: 'open'|'reviewed' } → ModerationReport[]  (newest first)
      ModerationReport = Report + reporter: PublicUser + targetUser: PublicUser|null + targetListing: ListingCard|null
moderation.reviewReport M  { id, action: ModerationAction, note?: string } → Report
      (sets status 'reviewed', reviewedById, reviewedAt, moderatorNote. action 'remove_listing' also sets the
       target listing's status to 'removed' — unless it is already 'removed' — and cancels its accepted
       reservation, if any, with cancelReason 'listing_removed'. A `completed` reservation is never touched.
       Requires targetListingId; BAD_REQUEST if the report has none.)
```

`M` = `moderatorProcedure` (protected + `ctx.user.id` must be in `MODERATOR_USER_IDS`; FORBIDDEN "Moderator access required." otherwise).

### Moderation env

`MODERATOR_USER_IDS` — comma-separated user ids with moderation access. `.env.example` defaults this to Maya's
fixed seed id (`00000000-0000-4000-8000-000000000001`) so the pilot always has a responsible operator who can
review reports. There is no roles table — this is deliberately the simplest thing that gives reports an owner.

## Account closure (`user.deleteAccount`)

Closes the caller's own account. **This is anonymization, not erasure** — say so in the UI and never imply otherwise.

Refused with `CONFLICT` when the caller has any `accepted` reservation (as buyer *or* seller): "Finish or cancel your open meetups before closing your account." This keeps the other party from being stranded mid-arrangement.

Otherwise, in one transaction:
- `users`: set `deletedAt`, `displayName` → `'Deleted user'`, `email` → `'deleted+<id>@account.invalid'`, `avatarUrl`/`bio` → null. The row stays so existing threads, reservations and reports still resolve.
- listings owned by the caller in `active`/`reserved`/`expired` → `removed` (`sold` and already-`removed` untouched, so sale history survives).
- reservations involving the caller in `requested`/`countered` → `cancelled`, `cancelReason: 'account_closed'`. `completed` reservations are never touched.
- delete: all `sessions` for the user (signs out everywhere), their `saved_listings`, all `blocks` in both directions, and any `email_codes` for the old address.
- **kept:** `messages` bodies (the other party's thread stays readable, attributed to "Deleted user"), `reports` they filed or that name them, and `completed` reservations.

`users.deletedAt` (nullable timestamptz) is added to the schema. `createContext` treats a session whose user has `deletedAt` set as signed out (`UNAUTHORIZED`). `user.byId` still returns the anonymized profile with `activeListingCount: 0`. A closed address can sign up again via `auth.requestCode` — it becomes a brand-new account.

**Not implemented (needs a real privacy review before launch):** hard erasure of message content, export-my-data, and any retention schedule.

Errors: use tRPC codes `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `BAD_REQUEST` with human-readable messages the UI can show verbatim.

## Seed (`backend/db/seed.ts`, idempotent)

- Campus: University of Arizona (`slug: arizona`, domains `arizona.edu`, tz `America/Phoenix`, `isDemo: true` because location data is unverified).
- Meetup spots (all `isDemo: true`, description says "Demo location — verify hours and permission before pilot"): Student Union Memorial Center (main entrance), Main Library (front steps), Old Main (front lawn), Student Recreation Center (entrance).
- Users (`isDemo: true`, `campusEmailVerifiedAt` set): **Maya Test** (`maya@demo.campus.test`, fixed id `00000000-0000-4000-8000-000000000001`), **Jordan Test** (`jordan@demo.campus.test`, id `…0002`). A third **Sam Test** (`…0003`) for the double-booking test.
- ~12 listings split between Maya and Jordan, mix of categories, 2–3 photos each (generated SVG placeholders with a visible "DEMO" mark served from `/api/uploads/demo-*.svg`), several with availability windows today, two `isSellToday`.
