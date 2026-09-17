# Data model + API contract

Everything below is the source of truth for backend and frontend agents. If you must deviate, update this file in the same change.

All ids are `uuid` strings. All timestamps are ISO strings over the wire (`timestamptz` in DB). Money is integer **cents** (`priceCents`).

## Enums

```ts
Category   = 'clothing' | 'shoes' | 'jewelry' | 'accessories' | 'dorm' | 'books' | 'tech' | 'other'
Condition  = 'new' | 'like_new' | 'good' | 'fair'
SaleType   = 'fixed' | 'auction'
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
- **listings**: id, sellerId, campusId, title, description?, category, condition, priceCents, **saleType** ('fixed' | 'auction', default 'fixed'), **startPriceCents?**, **buyoutPriceCents?**, size?, brand?, status, isSellToday bool, expiresAt? (also the auction end time), createdAt, updatedAt, soldAt?
- **bids**: id, listingId, bidderId, amountCents, createdAt; index `(listingId, amountCents desc)`. See `docs/AUCTIONS.md` §1 — that file is the source of truth for auctions.
- **listing_photos**: id, listingId, url, sortOrder, width?, height?
- **listing_spots**: listingId, spotId (PK both) — seller's acceptable spots
- **availability_windows**: id, listingId, startsAt, endsAt
- **conversations**: id, listingId, buyerId, sellerId, createdAt, lastMessageAt; unique(listingId, buyerId)
- **messages**: id, conversationId, senderId, body, createdAt
- **conversation_reads**: conversationId, userId (PK both), lastReadAt? — one row per participant per conversation; `null`/missing row means "never read". Kept as its own table (rather than two columns on `conversations`) so "who read what" stays answerable and group threads wouldn't need a second migration.
- **reservations**: id, listingId, buyerId, sellerId, status, spotId?, startsAt (agreed/proposed time), proposedById (who made the current proposal), priceCents (agreed price snapshot), handoffCode? (4 digits, set on accept), buyerConfirmedAt?, sellerConfirmedAt?, cancelledById?, cancelReason?, createdAt, updatedAt
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
                    + currentPriceCents (highest bid, else the fixed/start price) + bidCount
listing.byId          pub  { id }                   → ListingDetail = listing + photos[] + seller + spots[] + availabilityWindows[] + activeReservationId? + viewerRole ('seller'|'buyer'|'guest') + isSaved
listing.bySeller      pub  { sellerId, includeSold? } → ListingCard[]
listing.mine          P    –                        → ListingCard[] (all statuses)
listing.create        P    { title, description?, category, condition, priceCents, saleType?, startPriceCents?, buyoutPriceCents?, size?, brand?, isSellToday, photoUrls: string[] (1–8), spotIds: string[] (1+), windows: {startsAt,endsAt}[] (0+) } → ListingDetail
      saleType 'auction' requires startPriceCents >= 100 and, if given, buyoutPriceCents > startPriceCents.
      An auction ignores priceCents/isSellToday: priceCents mirrors startPriceCents and expiresAt = now + 24h.
listing.update        P    { id, ...same fields optional }             → ListingDetail
      CONFLICT "This auction already has bids, so its prices can't change." when bids exist and a
      price field or saleType changes.
listing.remove        P    { id }                   → { ok }   (CONFLICT when an auction already has bids)
listing.relist        P    { id, isSellToday, saleType?, startPriceCents?, buyoutPriceCents? } → ListingDetail
      (expired/removed → active; for an auction, clears every previous bid and sets expiresAt = now + 24h)

bid.place             P    { listingId, amountCents } → { bid, currentPriceCents, minNextBidCents, bidCount, endsAt, extended }
      BAD_REQUEST on a fixed-price listing, below the minimum increment, or at/above the buyout price.
      FORBIDDEN when the caller is the seller or either party has blocked the other.
      CONFLICT when the listing is not active or the auction has ended.
      `extended: true` means anti-snipe pushed `endsAt` out to now + 2 minutes.
bid.buyout            P    { listingId }           → { listingId, pricePaidCents, reservationId }
      Ends the auction (listing 'reserved', expiresAt = now) and creates the winner's reservation.
      BAD_REQUEST when there is no buyout price. CONFLICT when bidding already reached it.
bid.forListing        pub  { listingId, limit? }   → { id, listingId, amountCents, createdAt, bidder: PublicUser }[]
      Newest first. Bidders are display names only — never an email.
bid.mine              P    –                       → { id, amountCents, createdAt, listing: ListingCard, isTopBid }[]
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

## Push notifications (added after the sections above; nothing earlier was rewritten)

### Tables

- **device_tokens**: id, userId → users, expoPushToken (unique — re-registering the same token for a
  different user moves it, never duplicates it), platform ('ios' | 'android' | 'web' | 'unknown'),
  createdAt, lastSeenAt. A user may have several rows (several devices).
- **notification_preferences**: userId (PK, → users), messages bool (default true), meetups bool
  (default true), auctions bool (default true), updatedAt. Row is created lazily on first write; a
  missing row means every category is on.

### Router (`backend/trpc/routes/notification.ts`)

```
notification.register           P { expoPushToken, platform? } → { ok: true }
      Upserts on the unique expoPushToken — moves the token to the caller if it belonged to someone else.
notification.unregister         P { expoPushToken }             → { ok: true }
      No-op if the token isn't the caller's.
notification.preferences        P –                              → { userId, messages, meetups, auctions, updatedAt }
      Defaults every category to true when no row has ever been written.
notification.updatePreferences  P { messages?, meetups?, auctions? } → same shape
      Partial update; omitted categories keep their current (or default) value.
```

### Sending (`backend/notifications/`)

Sent via Expo's push service (`https://exp.host/--/api/v2/push/send`) over plain `fetch`, batched at
Expo's 100-message limit. `notifyUsers()` (`backend/notifications/send.ts`) is the single entry point:
it drops any recipient who has turned the relevant category off, loads their device tokens, sends, and
deletes any token Expo reports as `DeviceNotRegistered`. It never throws — every call site fires it
without `await` (`void notifyUsers(...)`) so a push failure can never fail the bid/message/reservation
mutation that triggered it. Per-event copy and recipient-building live in `backend/notifications/events.ts`.

Events wired: new message (recipient only, never the sender, never a blocked party — the send path
already refuses to send between blocked users, so this is inherited rather than re-checked), meetup
requested/accepted/declined/countered/cancelled (the other participant), outbid (the previous top
bidder only, from `bid.place` and `bid.buyout`), auction won (the winning bidder, from
`settleAuction()`/buyout), auction ended with no bids (the seller, from `settleAuction()`). Every
payload carries `data.path`, an expo-router path for the client to deep-link to on tap.

## Seed (`backend/db/seed.ts`, idempotent)

- Campus: University of Arizona (`slug: arizona`, domains `arizona.edu`, tz `America/Phoenix`, `isDemo: true` because location data is unverified).
- Meetup spots (all `isDemo: true`, description says "Demo location — verify hours and permission before pilot"): Student Union Memorial Center (main entrance), Main Library (front steps), Old Main (front lawn), Student Recreation Center (entrance).
- Users (`isDemo: true`, `campusEmailVerifiedAt` set): **Maya Test** (`maya@demo.campus.test`, fixed id `00000000-0000-4000-8000-000000000001`), **Jordan Test** (`jordan@demo.campus.test`, id `…0002`). A third **Sam Test** (`…0003`) for the double-booking test.
- ~12 listings split between Maya and Jordan, mix of categories, 2–3 photos each (generated SVG placeholders with a visible "DEMO" mark served from `/api/uploads/demo-*.svg`), several with availability windows today, two `isSellToday`.

## Trust summary (added after the sections above; nothing earlier was rewritten)

`user.trustSummary` — a derived reputation summary computed **only** from existing tables
(`reservations`, `listings`, `users`). There is no ratings/review system and no user-submitted score —
see docs/DESIGN.md "Trust signals" for the product reasoning and the copy rules this must follow.

```
user.trustSummary      pub  { id: uuid }   → TrustSummary
```

```ts
TrustSummary = {
  userId: string
  isDemo: boolean
  isClosed: boolean          // true when the account is closed (users.deletedAt set)
  memberSince: Date          // users.createdAt
  activeListingCount: number // listings: sellerId = id AND status = 'active'
  completedAsSeller: number  // reservations: sellerId = id AND status = 'completed'
  completedAsBuyer: number   // reservations: buyerId  = id AND status = 'completed'
  completedTotal: number     // completedAsSeller + completedAsBuyer
  cancelledByUser: number    // reservations: cancelledById = id AND status = 'cancelled'
}
```

Rules:
- Public procedure, same visibility as `user.byId`. Deliberately **not** block-aware: nothing else in
  the app hides a profile from a blocked viewer (only the feed, messaging and requests are
  block-gated), so this endpoint doesn't invent a new restriction either — a blocked viewer sees the
  identical result an anonymous viewer would.
- `NOT_FOUND` for an id that doesn't exist, matching `user.byId`.
- A closed/anonymized account (`deletedAt` set) returns `isClosed: true` and every count zeroed —
  including `completedAsSeller`/`completedAsBuyer`, even though `completed` reservations are kept per
  "Account closure" above. This is an intentional zero-out at the API boundary so a closed account's
  history never leaks through this endpoint, not a side effect of the underlying rows being deleted.
- All counts are honest zeros for a user with no history — never omitted, never an error.
- Counts come only from reservations in a **terminal** state (`completed`, `cancelled`); `requested`,
  `countered`, `accepted` and `expired` reservations are never counted as completed or as a
  cancellation.
- Computed as a small number of aggregate SQL queries (`count(*) filter (where ...)`), never one query
  per listing or per reservation.

**Deliberately not implemented, and why (do not fabricate these):**
- **No-shows.** The schema has no state meaning "the other participant confirmed this person didn't
  show up." `reports.reason = 'no_show'` is an unmoderated accusation one user files about another;
  treating it as a fact on a stranger's profile would present an unverified claim as verified history,
  which is worse than omitting the signal. Not surfaced anywhere in `trustSummary`.
- **"Cancelled after accepting" as a distinct count.** `reservations.status` is overwritten in place on
  cancel, and `handoffCode` is unconditionally nulled at the same time, so nothing on the row (or
  anywhere else) records whether a since-cancelled reservation had ever reached `accepted`.
  `cancelledByUser` is the closest honest substitute — every reservation this user cancelled, at any
  stage. The stricter figure would need a schema change (e.g. a status-history table, or a
  `reachedAcceptedAt` timestamp on `reservations`) that this change does not make — see the report to
  the founder for the recommendation.
