# Data model + API contract

Everything below is the source of truth for backend and frontend agents. If you must deviate, update this file in the same change.

> **Updated 2026-10-20.** Auctions are retired (offers replace them), meetups are booked into exact 15-minute slots, sign-in is phone-first, and a Community feed + transactional SMS exist. Inline statements below were corrected; the new sections at the end ("Auctions retired" onward) hold the detail. Where an older section and a newer section disagree, the newer section wins, and the code wins over both.

All ids are `uuid` strings. All timestamps are ISO strings over the wire (`timestamptz` in DB). Money is integer **cents** (`priceCents`).

## Enums

```ts
Category   = 'clothing' | 'shoes' | 'jewelry' | 'accessories' | 'dorm' | 'books' | 'tech' | 'other'
Condition  = 'new' | 'like_new' | 'good' | 'fair'
SaleType   = 'fixed' | 'auction'   // 'auction' is LEGACY: only old rows carry it; new listings are always 'fixed' (see "Auctions retired")
ListingStatus     = 'active' | 'reserved' | 'sold' | 'expired' | 'removed'
OfferStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired' | 'booked'
CommunityPostKind = 'buying' | 'selling'
SmsKind = 'listing_posted' | 'booking_confirmed' | 'meetup_reminder'
SmsStatus = 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'skipped'
ReservationStatus = 'requested' | 'countered' | 'accepted' | 'declined' | 'cancelled' | 'expired' | 'completed'
ReportReason = 'prohibited_item' | 'scam' | 'harassment' | 'no_show' | 'other'
ReportStatus = 'open' | 'reviewed'
ModerationAction = 'dismiss' | 'remove_listing' | 'note'
```

## Tables (Drizzle, Postgres)

- **campuses**: id, name, slug (unique), emailDomains text[], timezone, isDemo bool
- **users**: id, email (unique, private, **nullable** — phone-only accounts have none), phone? (E.164, unique, private), phoneVerifiedAt?, smsOptIn bool (default false), smsOptInAt?, smsOptOutAt?, displayName, avatarUrl?, campusId → campuses, campusEmailVerifiedAt?, bio?, isDemo, createdAt
- **sessions**: id, userId, tokenHash (unique), expiresAt, createdAt
- **email_codes**: id, email, code, expiresAt, consumedAt?
- **phone_codes**: id, phone, codeHash (sha256, never the code), purpose ('sign_in' | 'link'), userId?, attempts, expiresAt, consumedAt?, createdAt; index `(phone, createdAt)`
- **meetup_spots**: id, campusId, name, description (precise meeting description, e.g. "north entrance, by the bike racks"), lat, lng, hoursNote?, isDemo, isActive
- **listings**: id, sellerId, campusId, title, description?, category, condition, priceCents, **saleType** ('fixed' | 'auction', default 'fixed'; **legacy** — new rows are always 'fixed'), **startPriceCents?** and **buyoutPriceCents?** (legacy auction columns, null on new rows), size?, brand?, status, isSellToday bool, expiresAt? (always createdAt + 24h for new listings; for a legacy auction also its end time), createdAt, updatedAt, soldAt?
- **bids**: id, listingId, bidderId, amountCents, createdAt; index `(listingId, amountCents desc)`. **Retired, history only**: no code path writes it any more, rows are kept, and only legacy settlement reads it. See "Auctions retired" below (`docs/AUCTIONS.md` §1 is historical).
- **listing_photos**: id, listingId, url, sortOrder, width?, height?
- **listing_spots**: listingId, spotId (PK both) — seller's acceptable spots
- **availability_windows**: id, listingId, startsAt, endsAt
- **conversations**: id, listingId, buyerId, sellerId, createdAt, lastMessageAt; unique(listingId, buyerId)
- **messages**: id, conversationId, senderId, body, createdAt
- **conversation_reads**: conversationId, userId (PK both), lastReadAt? — one row per participant per conversation; `null`/missing row means "never read". Kept as its own table (rather than two columns on `conversations`) so "who read what" stays answerable and group threads wouldn't need a second migration.
- **reservations**: id, listingId, buyerId, sellerId, status, spotId?, startsAt (agreed/proposed time), proposedById (who made the current proposal), priceCents (agreed price snapshot), handoffCode? (4 digits, set on accept), buyerConfirmedAt?, sellerConfirmedAt?, cancelledById?, cancelReason?, offerId? (the accepted offer whose price this booking used), createdAt, updatedAt
  - **partial unique indexes**: `(listingId) WHERE status = 'accepted'` — DB guarantees one accepted hold per item; `reservations_seller_slot_uq (sellerId, startsAt) WHERE status = 'accepted'` and `reservations_buyer_slot_uq (buyerId, startsAt) WHERE status = 'accepted'` — nobody holds two accepted meetups at the identical instant (see "Booking").
- **reservation_events**: see "Booking".
- **offers**: see "Offers". **community_posts**: see "Community posts". **sms_messages**: see "Transactional SMS".
- **handoff_confirmations**: id, reservationId, userId, confirmedAt, method ('code' | 'tap')
- **blocks**: blockerId, blockedId (PK both), createdAt
- **reports**: id, reporterId, targetUserId?, targetListingId?, **targetPostId?** (→ community_posts), reason, details?, status ('open' | 'reviewed'), reviewedById?, reviewedAt?, moderatorNote?, createdAt
  - `reviewedById`/`reviewedAt`/`moderatorNote` are set by `moderation.reviewReport`; null until a moderator acts.
- **saved_listings**: userId, listingId (PK both), createdAt

## Reservation state machine (server-enforced, transactional)

```
(none) ──(buyer reservation.book)──▶ accepted        // direct, final; the new primary path
requested ──(seller accept)──▶ accepted ──(both confirm)──▶ completed
requested ──(seller counter)─▶ countered ──(buyer accept)─▶ accepted
countered ──(buyer counter)──▶ countered (roles flip via proposedById)
requested|countered ──(seller decline)──▶ declined
requested|countered|accepted ──(either cancel)──▶ cancelled
accepted ──(either propose reschedule)──▶ countered   (item stays 'reserved' until resolved)
accepted, startsAt + 2h passed, not completed ──(lazy expiry on read)──▶ expired
```

`reservation.request` → `counter` → `accept` is still implemented (and gated by `campusVerifiedProcedure`) for in-flight and legacy meetups, but the product path is `reservation.book` (see "Booking"). `counter` now requires a future time on the 15-minute grid inside the next 24h.

Effects:
- On **book**: see "Booking" — one transaction creates the reservation already `accepted`, sets the listing `reserved`, auto-declines other `requested|countered` reservations (cancelReason `'item_reserved'`) and closes every other open offer.
- On **accept** (inside one DB transaction): re-read listing `FOR UPDATE`; require `listing.status = 'active'` (or `'reserved'` by this same reservation when re-accepting a reschedule); set reservation `accepted`, generate `handoffCode`; set listing `reserved`; auto-`declined` every other `requested|countered` reservation on this listing (cancelReason `'item_reserved'`). If the partial unique index throws → return `CONFLICT` "This item was just reserved by someone else."
- On **cancel/decline/expire** of an accepted reservation: listing returns to `active` (unless listing is `expired` by its own `expiresAt`, in which case it stays `expired`; owner can relist).
- On **complete**: both parties confirmed (buyer via tap; seller via entering buyer's 4-digit code, or both tap). Reservation `completed`, listing `sold`, `soldAt` set. **No payment event is created or implied.**
- Requests (legacy path) are allowed only when `listing.status = 'active'`, requester ≠ seller, neither party has blocked the other, and `startsAt` is inside one of the listing's availability windows (or seller counters).
- Listing expiry (every listing: `expiresAt = createdAt + 24h`, `isSellToday` is now only a label): applied lazily by `applyExpiry()` at read time: `active` + past `expiresAt` → `expired`. A `reserved` listing does **not** expire while its accepted reservation is open, and a confirmed meetup stays readable (`reservation.byId`/`history`) after its listing expires.

## Auth

- `Authorization: Bearer <token>`. Server hashes token (sha256) and looks up `sessions`.
- Context: `{ db, user: User | null }`. `protectedProcedure` throws `UNAUTHORIZED` if no user. `campusVerifiedProcedure` = `protectedProcedure` + `FORBIDDEN` unless `user.campusEmailVerifiedAt` is set (see "Phone sign-in & account linking").
- Ownership: `listing.update/remove`, photo ops → seller only. `conversation.*`, `reservation.*` → participants only. Otherwise `FORBIDDEN`.
- Blocks: blocked users cannot message/request each other; blocked user's listings hidden from blocker's feed.

## tRPC router (`backend/trpc/app-router.ts`)

Namespaced routers. `P` = protected, `pub` = public. Inputs are zod; outputs are the row shapes above unless noted.

```
auth.requestPhoneCode / verifyPhoneCode / requestPhoneLinkCode / confirmPhoneLink / requestEmailLinkCode / confirmEmailLink — see "Phone sign-in & account linking"
auth.requestCode      pub  { email }                → { ok: true, simulated, resendAfterSeconds: 30 }   (email domain must be in ALLOWED_EMAIL_DOMAINS or a campus's emailDomains. Delivery is real when email is configured (`EMAIL_MODE=live` + `RESEND_API_KEY` + `EMAIL_FROM`), otherwise `simulated: true` and the code is in the server log. See "Sign-in email" below.)
auth.methods          pub  –                        → { primary: 'email' | 'phone', phone: { available, simulated }, email: { available, simulated } }   (which sign-in methods deliver codes now. `primary` is 'phone' only when SMS is live; otherwise 'email'. Clients lead with `primary` and offer the other as secondary.)
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
                    + currentPriceCents (the asking price; for a legacy auction, its top bid or start price) + bidCount (legacy; 0 on new listings)
listing.byId          pub  { id }                   → ListingDetail = listing + photos[] + seller + spots[] + availabilityWindows[] + activeReservationId? + viewerRole ('seller'|'buyer'|'guest') + isSaved
listing.bySeller      pub  { sellerId, includeSold? } → ListingCard[]
listing.mine          P    –                        → ListingCard[] (all statuses)
listing.create        C    { title, description?, category, condition, priceCents, saleType?, startPriceCents?, buyoutPriceCents?, size?, brand?, isSellToday, photoUrls: string[] (1–8), spotIds: string[] (1+), windows: {startsAt,endsAt}[] (**1–8**, each inside now → now+24h and ≥ 15 min) } → ListingDetail
      priceCents >= 100. saleType 'auction' is REFUSED (BAD_REQUEST "Auctions have been replaced by an asking price plus offers…"); omit saleType. startPriceCents/buyoutPriceCents are ignored.
      expiresAt = now + 24h for every listing. Enqueues the seller's "listing posted" SMS (see "Transactional SMS").
listing.update        P    { id, ...same fields optional }             → ListingDetail
      Editing `windows` re-applies the same window rules against the listing's own expiry; omitting `windows` leaves them alone.
      CONFLICT when the listing is a legacy auction ("…closes at its original end time. Relist it with an asking price afterwards."); BAD_REQUEST when saleType: 'auction' is sent.
listing.remove        P    { id }                   → { ok }   (CONFLICT when a legacy auction already has bids)
listing.relist        C    { id, isSellToday, priceCents?, windows?, (legacy: saleType?, startPriceCents?, buyoutPriceCents?) } → ListingDetail
      (expired/removed → active, saleType forced to 'fixed', expiresAt = now + 24h, windows replaced (none if omitted). Old bids are KEPT as history, not deleted. 'auction' is refused. Enqueues the listing-posted SMS.)

bid.place             P    { listingId, amountCents } → always PRECONDITION_FAILED "Bidding has been replaced by offers. Update Dibbs to make an offer or book at the asking price."
bid.buyout            P    { listingId }           → always PRECONDITION_FAILED (same message)
      Retired stubs kept only so a stale client gets a readable message. They never write anything.
      `bid.forListing` and `bid.mine` NO LONGER EXIST (removed; calling them is "procedure not found").
listing.toggleSave    P    { id, saved? }           → { saved: boolean }   (no `saved` = flip; with it = set)
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

reservation.slots     pub  { listingId }                      → bookable slots (see "Booking")
reservation.book      C    { listingId, spotId, startsAt, offerId?, expectedPriceCents? } → ReservationDetail (status 'accepted')
reservation.history   P    { id }                            → ReservationEvent[] oldest first (participants only)
reservation.request   C    { listingId, spotId|customAddress, startsAt }    → Reservation   (legacy request flow; see AUCTIONS.md §2 for customAddress)
reservation.counter   P    { id, spotId|customAddress, startsAt, note? }    → Reservation   (either party; sets proposedById; startsAt must be future, on the 15-min grid, within 24h. On an accepted meetup this is a reschedule.)
reservation.accept    P    { id }                            → Reservation   (the party who did NOT propose)
reservation.decline   P    { id }                            → Reservation   (seller)
reservation.cancel    P    { id, reason? }                   → Reservation   (either party)
reservation.byId      P    { id }                            → ReservationDetail = reservation + listing + spot + buyer + seller + handoffCode (buyer only sees it) + directionsUrl
reservation.mine      P    { role?: 'buyer'|'seller' }       → ReservationDetail[]
reservation.forListing P   { listingId }                     → Reservation[] (seller only)
reservation.confirmHandoff P { id, code? }                   → ReservationDetail  (buyer: tap; seller: must pass code)

user.byId             pub  { id }                   → PublicProfile { id, displayName, avatarUrl, campus, campusEmailVerified, isDemo, bio, activeListingCount, memberSince }
user.contactSettings P  –                        → { phone, phoneVerified, email, campusEmailVerified, smsOptIn, smsOptInAt, smsOptOutAt }   (private to the caller)
user.updateSmsPreferences P { smsOptIn }        → { smsOptIn }   (opt-in needs a verified phone; opt-out cancels queued texts)
user.updateMe         P    { displayName?, avatarUrl?, bio? } → User
user.block            P    { userId }               → { ok }
user.unblock          P    { userId }               → { ok }
user.blocked          P    –                        → PublicProfile[]
user.report           P    { targetUserId?, targetListingId?, reason, details? } → { ok }
user.deleteAccount    P    { confirmText: 'DELETE' }        → { ok: true }   (see "Account closure" below)

payment.quote         pub  { priceCents }           → { priceCents, platformFeeCents, sellerNetCents, feePercent, simulated: true, label: 'Simulated — no money moves' }
payment.config        pub  –                        → { paymentsEnabled, mode, simulated, banner, feePercent, ... }

**Payments are dormant (owner decision).** There is no payment in Dibbs: no platform fee, no card fee, no pay step. `reservation.book` needs no payment and ends on the booking confirmation (last step of `/reservation/request`); the buyer pays the seller in person and the seller keeps 100%. The Stripe code stays in the repo behind one switch, `PAYMENTS_ENABLED` (default off; `PLATFORM_FEE_PERCENT` default 0). While it is off: `payment.createIntent` and `payment.onboardSeller` return `PRECONDITION_FAILED`, the 24-hour unpaid timeout never runs (a booked meetup is never cancelled or blocked for being unpaid), `payment.byReservation` reports `timedOut: false`, and the app hides fee breakdowns, Pay buttons and Settings > Payouts (`payment.config.paymentsEnabled` is false). `/payments/:reservationId` redirects to `/reservation/:id`. `npm run test:payments` turns the switch on to keep the dormant logic tested.

moderation.isModerator P   –                        → boolean  (whether ctx.user.id is in MODERATOR_USER_IDS)
moderation.reports    M    { status?: 'open'|'reviewed' } → ModerationReport[]  (newest first)
      ModerationReport = Report + reporter: PublicUser + targetUser: PublicUser|null + targetListing: ListingCard|null
moderation.reviewReport M  { id, action: ModerationAction, note?: string } → Report
      (sets status 'reviewed', reviewedById, reviewedAt, moderatorNote. action 'remove_listing' also sets the
       target listing's status to 'removed' — unless it is already 'removed' — and cancels its accepted
       reservation, if any, with cancelReason 'listing_removed'. A `completed` reservation is never touched.
       Requires targetListingId; BAD_REQUEST if the report has none.)
```

Procedure kinds: `P` = protected, `C` = `campusVerifiedProcedure`, `M` = `moderatorProcedure`. Offer, community and notification routers are documented in their own sections below.

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
- also (added with phone sign-in/offers/community): `phone`, `phoneVerifiedAt` → null and `smsOptIn` → false (`smsOptOutAt` = now), freeing the number for a new signup; the caller's `pending|accepted` offers (as buyer or seller) → `withdrawn` (`closeReason 'account_closed'`); their live community posts are removed; their `phone_codes` deleted; every still-`scheduled` SMS for them is cancelled.
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
  (default true), auctions bool (default true; **legacy**, kept so old clients keep working, no longer triggers anything), offers bool (default true), updatedAt. Row is created lazily on first write; a
  missing row means every category is on.

### Router (`backend/trpc/routes/notification.ts`)

```
notification.register           P { expoPushToken, platform? } → { ok: true }
      Upserts on the unique expoPushToken — moves the token to the caller if it belonged to someone else.
notification.unregister         P { expoPushToken }             → { ok: true }
      No-op if the token isn't the caller's.
notification.preferences        P –                              → { userId, messages, meetups, auctions, offers, updatedAt }
      Defaults every category to true when no row has ever been written.
notification.updatePreferences  P { messages?, meetups?, offers?, auctions? (legacy) } → same shape
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
requested/accepted/declined/countered/cancelled (the other participant), offer received (the seller), offer accepted / declined (the buyer) under the `offers` category, meetup booked (the seller, from `reservation.book`), and — for legacy auctions only — auction won / ended with no bids from `settleAuction()` under the legacy `auctions` category. Outbid pushes no longer exist (no bidding). Every
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

---

## Auctions retired (2026-10-20; added after the sections above)

Dibbs no longer runs auctions. An item has an **asking price**, and buyers either **book it at that price** or send the seller an **offer** below it. There are no bids, rounds, rankings, timers racing other buyers, or automatic winners.

**Refused**
- `listing.create` / `listing.relist` with `saleType: 'auction'` -> BAD_REQUEST "Auctions have been replaced by an asking price plus offers…". Clients omit `saleType` (it defaults to `'fixed'`); `startPriceCents`/`buyoutPriceCents` are ignored.
- `listing.update` on a legacy auction -> CONFLICT; `saleType: 'auction'` -> BAD_REQUEST.
- `bid.place`, `bid.buyout` -> PRECONDITION_FAILED "Bidding has been replaced by offers…" (stubs for stale clients; they write nothing). `bid.forListing` and `bid.mine` were removed outright.
- `offer.create` and `reservation.slots`/`book` on a legacy auction listing -> CONFLICT / `open: false` with `LEGACY_AUCTION_MESSAGE`: "This was posted as an auction before Dibbs switched to asking prices. It closes at its original end time." UI: show the asking price (the listing's `priceCents`), that message, and no offer or book actions.
- The `auctions` notification category no longer fires for anything new (see Push notifications). The preference flag remains for old clients.

**Kept (non-destructive)**
- Every `bids` row, `listings.saleType/startPriceCents/buyoutPriceCents` column, and existing auction reservations and payments are untouched. Migration `0009` changes none of them.
- `listing.relist` of a former auction forces `saleType = 'fixed'` and keeps the old bid rows as history.
- `docs/AUCTIONS.md` §1 is historical; §2 (custom addresses) and §3 (payments) still apply.

**Legacy settlement.** A listing that was already an auction when this shipped is settled by `applyExpiry` -> `settleAuction()` (`backend/trpc/lib.ts`) at its original `expiresAt`, exactly as before: top bid wins and gets a reservation (and the existing payment step), or the listing expires if there were no bids. Every auction ran at most 24 hours, so this path drains by itself within a day of deploy. `settleAuction` can be deleted after that. The anti-snipe/increment helpers in `lib.ts` exist only for it.

**Migration pre-check (hosted DB).** `0009` adds partial unique indexes `reservations_seller_slot_uq` / `reservations_buyer_slot_uq` that fail if anyone already holds two accepted meetups at the identical instant. Before running it, check:

```sql
select seller_id, starts_at, count(*) from reservations
where status='accepted' group by 1,2 having count(*) > 1;
```

Resolve any rows by hand (never automatically). The same applies to `buyer_id`. `0009` also seeds one `imported` `reservation_events` row per existing reservation.

---

## Offers (added after the sections above)

An offer agrees a **price** and holds the item briefly. It never reserves the item by itself; `reservation.book` does (see "Booking").

**Table `offers`**: id, listingId, buyerId, sellerId, amountCents (> 0, CHECK), askingPriceCents (snapshot), message?, status, closeReason?, expiresAt (a pending offer never outlives the listing: the listing's `expiresAt`), holdExpiresAt? (set on accept), respondedAt?, reservationId? (set when booked), createdAt, updatedAt.
**Indexes**: partial unique `offers_one_accepted_per_listing (listingId) WHERE status='accepted'`; partial unique `offers_one_open_per_buyer (listingId, buyerId) WHERE status IN ('pending','accepted')`; `offers_seller_idx (sellerId, status)`; `offers_buyer_idx (buyerId, status)`.

**States**
```
pending ──(seller accept)──▶ accepted ──(buyer reservation.book)──▶ booked
pending ──(seller decline)─▶ declined
pending|accepted ──(buyer withdraw)──▶ withdrawn
pending, listing expiry passes ──▶ expired        (closeReason offer_expired)
accepted, hold passes ──▶ expired                 (closeReason hold_lapsed)
pending|accepted, listing expired/removed/sold ──▶ expired   (closeReason listing_closed)
pending|accepted, someone else books the item ──▶ declined   (closeReason item_reserved)
account closed ──▶ withdrawn                      (closeReason account_closed)
```
Lapses are applied lazily by `expireOffers()` (called from `applyExpiry` and the read-path sweep).

**Hold rule.** `offer.accept` sets `holdExpiresAt = min(now + OFFER_HOLD_MS, listing.expiresAt)`; `OFFER_HOLD_MS` = 1 hour (`backend/trpc/lib.ts`). While the hold is live nobody else can book the item (`reservation.book` -> CONFLICT "The seller accepted another offer on this item…") and the seller cannot accept a second offer. The listing row lock plus `offers_one_accepted_per_listing` serialize accept vs book. If the buyer books in time, the booking uses the offer's `amountCents`.

```
offer.create    C    { listingId, amountCents, message? (<=280) } → Offer   (buyer)
offer.accept    P    { id }                  → Offer   (seller only; status accepted, holdExpiresAt set)
offer.decline   P    { id, reason? }         → Offer   (seller only; pending only)
offer.withdraw  P    { id }                  → Offer   (buyer only; pending or accepted, i.e. also releases a hold)
offer.forListing P   { listingId }           → { viewerRole: 'seller'|'buyer', offers: DecoratedOffer[], heldUntil, heldByViewer, heldByOther }
      Seller sees every offer on the listing; anyone else sees only their own. NOTE: protected (signed in), not public.
offer.mine      P    { role?: 'buyer'|'seller' } → DecoratedOffer[]   (newest-updated first, max 100)
DecoratedOffer = Offer + listing: ListingCard | null + buyer: PublicUser + seller: PublicUser
```

**Validation / errors** (all human-readable): `amountCents` >= 100 ("Offers start at $1.") and < the asking price ("That is at or above the asking price — just book it at the asking price instead.") and <= $5,000; not your own listing (BAD_REQUEST); blocked either way (FORBIDDEN); legacy auction, or listing not `active`/past expiry (CONFLICT); a second open offer by the same buyer (CONFLICT "You already have an open offer on this item. Withdraw it to make a new one."); accept/decline/withdraw on an offer already closed (CONFLICT "This offer is already <status>."); only the seller may accept/decline and only the buyer may withdraw (FORBIDDEN). Offers push to the `offers` notification category (received -> seller; accepted/declined -> buyer).

---

## Booking (exact slot + campus place; added after the sections above)

`reservation.book` replaces request -> accept as the primary flow: the buyer picks a spot and an exact time from the seller's published availability and the meetup is **final at once** (`status: 'accepted'`, listing `reserved`, handoff code issued). The old `request`/`counter`/`accept` procedures stay for in-flight and rescheduling use.

**Rules**
- **Slot grid**: meetups are `MEETUP_SLOT_MINUTES` = 15 minutes long and start only on a quarter hour (:00 / :15 / :30 / :45) (`isSlotAligned`, checked on the UTC epoch). Times are stored as UTC; the UI must display them in the campus timezone (`slots.timezone`, e.g. `America/Phoenix`).
- **Rolling availability**: sellers publish availability for "now -> next 24 hours" (`AVAILABILITY_HORIZON_MS`), which is also the listing's whole life.
- **Window validation** (`listing.create`, `listing.update`, `listing.relist`): 1–8 windows on create (relist/update may have none, but a listing with none has no bookable slots); each must end in the future, start no earlier than now minus a 15-minute grace, end within the listing's own expiry (+1 min), and leave room for at least one 15-minute slot after `max(start, now)`.
- **Bookable time** (`book`, `counter`): on the grid, in the future, within 24h; and — for `book` — re-checked inside the row lock to be exactly one of the slots the seller's current windows produce (otherwise CONFLICT "The seller's availability changed. Pick one of the times shown now.").
- **Spot** must be one of the listing's active `listing_spots` (BAD_REQUEST otherwise).

**Double-booking guard (seller AND buyer).** `slotConflicts()` rejects a slot if either person already has an `accepted` meetup starting within +/-15 minutes (strictly overlapping; back-to-back slots are allowed), on any listing (CONFLICT "That time was just booked. Pick another slot." for the seller; "You already have a meetup at that time." for the buyer). Both users' rows are locked in id order first so concurrent bookings serialize. The DB backstop is two partial unique indexes: `reservations_seller_slot_uq (sellerId, startsAt) WHERE status='accepted'` and `reservations_buyer_slot_uq (buyerId, startsAt) WHERE status='accepted'`; a violation is mapped to the same "just booked" CONFLICT.

**Procedures**
```
reservation.slots   pub  { listingId } → {
      listingId, open, closedReason, timezone, slotMinutes: 15, expiresAt, spots: MeetupSpot[],
      slots: { startsAt, available, reason: 'seller_busy'|'you_busy'|null }[] }
      open=false (and slots=[]) with a closedReason for an expired/reserved/removed listing or a legacy auction.
      `you_busy` only appears for a signed-in non-seller viewer.
reservation.book    C    { listingId, spotId, startsAt, offerId?, expectedPriceCents? } → ReservationDetail
reservation.history P    { id } → ReservationEvent[]   (participants only, oldest first)
```
- **Price** = the listing's asking price, or the viewer's live accepted offer's `amountCents` while its hold lasts. `expectedPriceCents` (send the price shown on the confirm step): mismatch -> CONFLICT "The price changed since you opened this…". `offerId`, if sent, must be the live accepted offer or CONFLICT.
- **Idempotent**: the same buyer re-submitting the same listing + spot + time while their booking is `accepted` gets the existing reservation back with no new event, text or push. Same buyer, different slot -> CONFLICT "You already booked this item. Reschedule from your meetup instead."
- **Other CONFLICTs**: slot taken; item already booked ("just booked by someone else"); listing expired/unavailable; held by another buyer's accepted offer; legacy auction. Own listing -> BAD_REQUEST; blocked -> FORBIDDEN.
- **Side effects** (one transaction): listing -> `reserved`; other `requested|countered` reservations on the item -> `declined` (`item_reserved`); the used offer -> `booked` (with `reservationId`) and every other open offer -> `declined`. After commit: `booked` history event, SMS outbox rows, a meetup push to the seller.
- **Reschedule** = `reservation.counter` (aligned future time) then the other party's `reservation.accept`; **cancel** = `reservation.cancel`. Both update availability (the accepted row stops blocking the slot) and the texts (see "Transactional SMS").
- **Durability**: a confirmed meetup is not tied to the listing's lifetime. The listing stays `reserved` while the reservation is `accepted`, and `reservation.byId`/`history` keep working after `expiresAt`. An `accepted` meetup lazily becomes `expired` only 2h after `startsAt` if never completed.

**Table `reservation_events`** (append-only history): id, reservationId, actorId? (null = system/import), kind (text), status (the reservation status after the event), startsAt, spotId?, priceCents, createdAt; index `(reservationId, createdAt)`. Kinds written: `booked`, `requested`, `countered`, `accepted`, `declined`, `rescheduled` (a counter on an accepted meetup), `cancelled`, `completed`, `expired`, and `imported` (one row per pre-existing reservation, written by migration 0009). This is what makes "cancelled after accepting" answerable from now on; it does not retroactively fix `trustSummary.cancelledByUser`.

---

## Community posts (added after the sections above)

Short "interest check" posts ("Anyone selling a mini fridge?", "Anyone want shirts? I have a bunch"). Replaces the old Inbox tab slot.

**Table `community_posts`**: id, campusId, authorId (cascade on user delete), kind ('buying' | 'selling'), body, createdAt, expiresAt, removedAt?, removedById?; indexes `community_posts_feed_idx (campusId, createdAt desc, id desc)`, `community_posts_author_idx (authorId)`.

**Rules**
- **Campus scope**: you only ever see, open, or report posts from your own campus.
- **Exact 24h expiry**: *superseded October 24, 2026, see "Archive, buyer-proposed meetups and permanent posts" below: posts no longer expire.*
- **Cap**: *superseded: at most `COMMUNITY_MAX_POSTS_PER_DAY` = 5 new posts per person in any rolling 24 hours (TOO_MANY_REQUESTS).* Body 3–280 chars.
- **Identity**: posts show the author's normal display name; no anonymity.
- **Blocks** hide posts in both directions (feed, `byId`, `report`).
- Posting requires a campus-verified account; reading requires any signed-in account.

```
community.feed         P  { kind?, cursor?, limit? (1–50, default 20) } → { items: { id, kind, body, createdAt, expiresAt, author: PublicUser, isMine }[], nextCursor?, serverNow }
community.byId         P  { id }                       → one item (same shape)
community.create       C  { kind, body }               → item
community.remove       P  { id }                       → { ok }   author only; sets removedAt/removedById
community.report       P  { id, reason, details? }     → { ok }   inserts a `reports` row with targetPostId and targetUserId = author; not your own post
community.moderatorRemove M { id }                     → { ok }   takedown from the moderation queue
```
`reports.targetPostId` -> `community_posts` (cascade). Reports enter the same moderation queue.

---

## Messaging (unchanged; added after the sections above)

`conversation.*` is exactly as documented above. What changed is where it lives in the UI: messaging is **not a tab**. It is reachable from a listing ("Message seller") and from a meetup, plus the `app/inbox.tsx` stack screen titled "Meetups & messages" (the old list, moved off the tab bar). `conversation.unreadTotal` still feeds badges.

---

## Sign-in email (Resend)

Email sign-in codes (`auth.requestCode`, `auth.verifyCode`, `auth.requestEmailLinkCode`, `auth.confirmEmailLink`) are sent through `backend/email/provider.ts`.

- **Delivery.** Real email goes out through Resend only when `EMAIL_MODE=live` AND `RESEND_API_KEY` AND `EMAIL_FROM` are all set. Otherwise the provider is simulated: nothing is sent and the code is printed to the server log. Tests always simulate. In live mode codes are never written to the log, and a send error message never includes the code.
- **Rules.** Same as phone codes: 6 digits, 10-minute expiry, 5 wrong guesses, 30-second resend cooldown (`resendAfterSeconds: 30`), and at most 5 codes per email per rolling hour (TOO_MANY_REQUESTS with how long to wait). If the send fails, the code is consumed immediately and the client gets INTERNAL_SERVER_ERROR "We couldn't send the code. Try again."
- **Return shape.** `requestCode` and `requestEmailLinkCode` return `{ ok: true, simulated: boolean, resendAfterSeconds: 30 }`. `simulated: true` means no email was sent, so the UI can show the honest development note.
- **Sign-in order.** `auth.methods` decides the lead method. Email is primary until SMS is live; phone becomes primary automatically once `SMS_MODE=live` and the Twilio settings are in place. No client change is needed for that switch.
- **Health.** `GET /api/health` includes `email: { mode: 'simulated' | 'live', simulated: boolean }`, next to `sms` and `payments`. Use it to confirm a deployment is live before testing sign-in.

## Phone sign-in & account linking (added after the sections above)

Phone + SMS code is the primary sign-in. Campus email + code (`auth.requestCode`/`verifyCode`) still works ("Use campus email instead") and is how existing email accounts sign in.

**Normalization** (`backend/sms/phone.ts`): stored as E.164. A bare 10-digit (or 11 digits starting with 1) number is read as +1 (US/Canada pilot); anything else must start with `+`, 8–15 digits, not leading 0; a +1 number must have exactly 11 digits. Invalid -> BAD_REQUEST with a readable message. Phone is `unique` on `users`.

**Code rules** (`phone_codes`; stored only as sha256 of phone+code, never the code):
- 6 digits; expires in 10 minutes (`expiresInSeconds: 600`).
- Max 5 wrong guesses per code (the 5th burns it): "That code is wrong. N tries left."
- 30-second resend cooldown (`resendAfterSeconds: 30`) and at most 5 codes per number per rolling hour -> TOO_MANY_REQUESTS with how long to wait. Plus the per-minute IP/session limiters `RATE_LIMIT_PHONE_REQUEST_PER_MIN` (default 5) and `RATE_LIMIT_PHONE_VERIFY_PER_MIN` (default 10).
- If the text fails to send, the new code is consumed immediately so no usable code is left behind.
- Delivery is **simulated** unless live SMS is configured (see "Transactional SMS"): the code is printed to the server log. Email codes follow their own delivery mode (see "Sign-in email" below).

```
auth.requestPhoneCode     pub { phone }                    → { ok, simulated, resendAfterSeconds: 30, expiresInSeconds: 600 }
auth.verifyPhoneCode      pub { phone, code, displayName?, campusId?, smsOptIn? }
      → { status: 'needs_profile' }                         (new number; the code is NOT consumed — ask name + campus + SMS consent, then call again with the same code)
      → { status: 'signed_in', token, isNewAccount, user }  (user includes `campus`)
auth.requestPhoneLinkCode P   { phone }                    → same shape as requestPhoneCode (attach a phone to the signed-in account)
auth.confirmPhoneLink     P   { phone, code, smsOptIn? }   → { ok, user }
auth.requestEmailLinkCode P   { email }                    → { ok, simulated, resendAfterSeconds: 30 }   (campus email domain required; same cooldown and cap as sign-in email)
auth.confirmEmailLink     P   { email, code }              → { switchedAccount: boolean, token: string|null, user }
```
A new phone account is created with `email = null`, `phoneVerifiedAt = now`, `campusEmailVerifiedAt = null`, `smsOptIn` false unless the client passes `smsOptIn: true` (the consent checkbox must be unchecked by default).

**Phone verified is not campus verified, and neither is identity verified.** A phone proves control of a number only. `users.campusEmailVerifiedAt` is set only by verifying a campus email (`verifyCode` or `confirmEmailLink`). Copy must never imply a phone-verified person is a student, or that either check is identity verification.

**`campusVerifiedProcedure` gate** (FORBIDDEN "Verify your campus email to buy, sell, or post. Phone sign-in alone does not confirm you are a student."): `listing.create`, `listing.relist`, `offer.create`, `reservation.book`, `reservation.request`, `community.create`. Everything else (browse, search, message, save, read community, view offers/meetups already owned) stays open to a phone-only account. Note `offer.accept/decline/withdraw` and `reservation.accept/counter/cancel` are plain `protectedProcedure`.

**Linking rules** (`backend/auth/accounts.ts`; never auto-merge two accounts that both have history). "Has activity" = any listing as seller, reservation, offer, conversation, or community post.
- `confirmPhoneLink`: if the number already belongs to another (non-deleted) account **with activity** -> CONFLICT ("…Sign in with the phone to use that account, or contact support to combine them."); if that account is empty it is retired and the number moves here. `smsOptIn` omitted keeps the current consent; `true` opts in; `false` records an opt-out.
- `confirmEmailLink` (verifies a campus email for the signed-in, usually phone-only, account):
  - the email has no account -> it is attached here; `campusEmailVerifiedAt = now`, `campusId` follows the email's campus; `switchedAccount: false`, `token: null`.
  - the email already belongs to another account and **the caller is empty** -> the caller's phone (and consent) moves onto the email account, the empty phone account is retired, and a session for the email account is returned: `switchedAccount: true` with a new `token` that the client must store.
  - the email account is empty but the caller has history -> the email account is retired and the email moves to the caller.
  - **both have history** -> CONFLICT, nothing changes.
- Retiring an empty account anonymizes it (`merged+<id>@account.invalid`, displayName "Deleted user", phone cleared, sessions and codes deleted).
- `user.contactSettings` / `user.updateSmsPreferences` expose and change consent (see router above).

---

## Transactional SMS (added after the sections above)

Only three event texts exist. They go through a durable outbox, not inline sends. **Verification codes are separate**: they are sent synchronously when the user asks, are never stored in `sms_messages` or logged in production (only masked), and ignore the transactional opt-in.

**Table `sms_messages`**: id, userId? (set null on user delete), kind ('listing_posted' | 'booking_confirmed' | 'meetup_reminder'), dedupeKey (**unique**), body, status ('scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'skipped'), sendAfter, attempts, lastError?, providerMessageId?, reservationId?, listingId? (both cascade), meetupStartsAt?, createdAt, updatedAt, sentAt?; indexes `sms_messages_due_idx (status, sendAfter)`, `sms_messages_reservation_idx (reservationId)`.

**Consent fields** (on `users`): `phone`, `phoneVerifiedAt`, `smsOptIn` (default false), `smsOptInAt`, `smsOptOutAt`. A recipient is eligible only if the account is not closed, has a **verified** phone, **and** `smsOptIn` is true. Opt-in is explicit (checkbox unchecked by default at sign-up/link, or `user.updateSmsPreferences`). Opting out cancels every still-`scheduled` text for that user; closing the account does the same.

**Kinds and recipients** (`backend/sms/outbox.ts`)
| kind | when | recipient | dedupeKey |
|---|---|---|---|
| `listing_posted` | after `listing.create` and `listing.relist` | the **seller only** | `listing_posted:<listingId>:<listing.createdAt>` |
| `booking_confirmed` | meetup reaches `accepted` (`reservation.book`, or `reservation.accept` incl. an accepted reschedule) | **both** buyer and seller, each only if eligible; buyer text has item + price, seller text names the buyer | `booking_confirmed:<reservationId>:<userId>:<startsAt ISO>` |
| `meetup_reminder` | 30 minutes before `startsAt` (`sendAfter = startsAt - 30 min`) | **both** participants, each only if eligible | `meetup_reminder:<reservationId>:<userId>:<startsAt ISO>` |

- Because keys include `startsAt`, a retry/double-submit inserts nothing (`ON CONFLICT DO NOTHING`) while a reschedule produces a fresh confirmation + reminder.
- **Booked with less than 30 minutes to go**: no reminder row is written (the confirmation says "in N min").
- **Reschedule** (`counter` on an accepted meetup): every `scheduled` text for that reservation is cancelled immediately; new rows are written when the new time is accepted. **Cancel / decline / expiry / completion**: every `scheduled` text for the reservation is cancelled (`cancelBookingSms`). Texts already `sent` are not recalled.
- Bodies end with "Reply STOP to opt out." (listing + confirmation texts); links use `SMS_APP_LINK_BASE` (falls back to `EXPO_PUBLIC_WEB_BASE_URL`, then a `dibbs://` link).

**Dispatcher.** `startSmsDispatcher` (called from `backend/server.ts`) runs `dispatchDueSms` every `SMS_DISPATCH_INTERVAL_MS` (default 30000; `0` disables it). It claims due rows with `FOR UPDATE SKIP LOCKED`, requeues rows stuck in `sending` for over 5 minutes, and:
- **Stale-row skip**: right before sending it re-validates. Row becomes `skipped` (never sent) if the recipient is no longer eligible, a booking text's reservation is no longer `accepted`, its `startsAt` no longer equals `meetupStartsAt`, or a reminder's meetup has already started.
- **Retries**: a retryable failure goes back to `scheduled` with backoff 1, 2, 4, 8 minutes; the **5th** failed attempt, or any non-retryable error (Twilio 4xx other than 429, e.g. invalid number or unsubscribed), sets `failed`.

**Provider mode** (`backend/sms/provider.ts`): `simulated` (default; logs a masked line and keeps an in-memory list) or `live` (Twilio REST over fetch). Live requires `SMS_MODE=live` **and** `TWILIO_ACCOUNT_SID` **and** `TWILIO_AUTH_TOKEN` **and** `TWILIO_FROM` **and** `SMS_LIVE_ACK=1`, and never runs under `NODE_ENV=test`; a half-configured environment falls back to simulated. The Twilio code has never executed against a real account. See `docs/DEPLOY.md` for setup and the STOP-sync gap.


## Booking confirmation email and Twilio STOP callback (October 21, 2026)

`reservation.book` and `reservation.accept` atomically insert `booking_emails`
rows inside their booking transaction. One row per participant and meetup start;
repeated submissions do not duplicate rows. The table contains id, reservationId,
userId, meetupStartsAt, unique dedupeKey, status, attempts, sendAfter, updatedAt.
The worker claims up to 20 rows with SKIP LOCKED every 30 seconds and recovers
claims older than five minutes. It checks current accepted state/time, future
start, non-deleted recipient and verified campus email before delivery. Cancelled,
rescheduled or otherwise stale confirmations become skipped. Retries back off
1/2/4/8 minutes; the fifth failure is terminal. Resend receives a stable
Idempotency-Key per row. Provider acceptance is not proof of inbox delivery.
These are booking confirmations only, not email reminders or cancellation notices.
No handoff code, other participant email or payment receipt is included.

`POST /api/sms/inbound` accepts form callbacks authenticated using Twilio's
HMAC-SHA1 signature, the configured exact `TWILIO_INBOUND_WEBHOOK_URL`, and the
configured Account SID. Missing config returns 503; invalid signatures return
403. STOP/standard opt-out keywords or Advanced Opt-Out `OptOutType=STOP` revoke
app SMS consent and cancel scheduled texts atomically. Duplicate callbacks are
safe. START does not re-enable app consent: re-opt-in is via app settings after
carrier unblocking. Twilio handles its own opt-out reply; the app returns empty
TwiML. Already-sending messages may be in flight. Live delivery is unverified.

## Comment replies and listing comments (October 22, 2026)

- **Replies are one level deep** on both community comments and listing
  comments. `parent_id` always names a top-level comment on the same post or
  listing; replying to a reply stores it against that top-level comment.
  Lists come back flat and oldest first, each item with `parentId`; the client
  groups them. A reply whose parent was removed stays readable.
- `community.addComment` takes optional `parentId` (must be readable to the
  caller and on the same post, else NOT_FOUND / BAD_REQUEST).
  `community.comments` items include `parentId`. Post `commentCount` counts replies.
- New `listing_comments` table and `listingComment` router:
  - `list({ listingId })` public. NOT_FOUND for a removed listing. Hides removed
    comments, closed accounts and (signed in) blocked users either way. Each
    item has `isSeller`, `isMine`, `canRemove`.
  - `add({ listingId, parentId?, body })` campus-verified, 1–500 chars, only
    while the listing is `active` or `reserved`; NOT_FOUND if the caller and
    seller are blocked either way.
  - `remove({ id })` soft removal by the author, the listing's seller, or a
    moderator. `moderatorRemove({ id })` for the queue.
- Tested by `npm run test:comments`.

## Likes, shares and Hottest; Community listing posts (October 22, 2026)

Migration `0016_listing_engagement` (additive only: two new tables, one nullable column, one unique index; no backfill, nothing rewritten).

**Likes** (`listing_likes`, PK `(listing_id, user_id)`). Public popularity, separate from Saved (`saved_listings`, a private bookmark; neither affects the other).
- `listing.setLike { id, liked }` protected. Sets (never toggles) the viewer's like, so a double-tap or retry cannot add a second row. Returns `{ id, likeCount, viewerLiked }`. Liking needs the listing to be live (active, before its deadline), on the viewer's campus, not owned by someone in a block relationship with the viewer; otherwise NOT_FOUND. Taking a like back never needs the listing to still be live.

**Shares** (`listing_shares`, PK `(listing_id, user_id)`). One honest counting rule: a share is counted when a **signed-in** person handed the listing link to the OS/browser share sheet and did **not** cancel it, or copied the link. One per person per listing. The platform never reports what the other app did with the link, so this is "shares started", never "posted to Instagram": no copy in the app claims otherwise. Known limits: on Android the OS cannot report a dismissed share sheet, so a cancelled sheet may count there; the intent-URL chips (WhatsApp, X, ...) are not counted because opening a destination is not observable completion; signed-out taps still share but are not counted.
- `listing.recordShare { id, via: 'share_sheet' | 'copy_link' }` protected, same visibility rules as `setLike`. Returns `{ id, shareCount, viewerShared, counted }` (`counted` is false for a repeat).

**Engagement on feed rows.** Every `listing.feed` item and every Community listing post carries `engagement: { likeCount, viewerLiked, shareCount, viewerShared, commentCount, topComments[] }`, read by one helper (`backend/trpc/engagement.ts`) from the listing's own rows so Browse and Community can never disagree. `commentCount` counts the comments the viewer can read, replies included (same as the thread). `topComments` is at most two **top-level** comments (author id, name, avatar, body, time; no vote totals, listing comments have none), most-discussed first (readable replies), then oldest first. Removed comments, closed accounts and blocked people never appear.

**Hottest.** `listing.feed` takes `sort: 'new' | 'hot'` (default `'new'`: strictly `createdAt desc, id desc`, unchanged). `'hot'` scores each listing as Σ time-decayed signals, using the same recipe as Community posts (`backend/trpc/hot.ts`: half-life 30 min, 6 h window): each like x1, each readable comment x2 (`HOT_COMMENT_WEIGHT`), each share x1. Ties fall back to newest. Pagination uses a JSON cursor that freezes `asOf`, like `community.feed`. Community's `top` and `hot` sorts score a listing post from its listing's likes/comments/shares by the same formula.

**Community listing posts.** `community_posts.listing_id` (nullable, **UNIQUE**) marks the automatic compact post every listing gets. It is a pointer row: `kind` is `selling`, author is the seller, and caption, price, photo, status, likes, shares and comments are read from the listing at query time.
- Created by `listing.create` and refreshed by `listing.relist` via an upsert on `listing_id` (`backend/trpc/listing-post.ts`), so retries and relists never add a second post. A failure to write it never fails the listing.
- Visible only while the listing is `active` and before its deadline (same as Browse); sold, expired or removed listings leave Community at the same moment. Campus scope and blocks (either direction) apply as for any post. The post's own `removedAt` is only a moderator takedown of the Community entry.
- `community.feed` items add `listing` (the live listing card, or `null` for a text post) and `engagement` (or `null`); for a listing post `voteCount`/`viewerVoted`/`commentCount` are the listing's like and comment numbers and `body` is the live caption (description, else title).
- There is **no separate thread or vote** on a listing post: `community.setVote`, `comments`, `addComment` reject it (BAD_REQUEST, "like, comment or report it from the listing"); likes and comments go through `listing.setLike` and `listingComment.*`. `community.remove` rejects it (remove the listing instead). `community.report` on a listing post files the report against the **listing** (`targetListingId`, `targetPostId` null), so moderators handle it in the same queue as Browse reports.
- Automatic posts do not count toward `COMMUNITY_MAX_LIVE_POSTS`, and are left out of a profile's text posts (`user.posts`) and the admin "community posts" count.
- Ordinary text posts (buying/selling) are unchanged.
- Tested by `npm run test:engagement` (58 checks).

## Archive, buyer-proposed meetups and permanent posts (October 24, 2026)

Owner decision. Migration `0017_posts_no_expiry` (additive: `community_posts.expires_at` becomes nullable).

**Listings.** A listing is still live in the main Browse feed for exactly 24 hours (`listings.expiresAt`, unchanged). After that, if it is unsold it is **archived**: status `expired` (or `active` past its deadline, before the sweep). Nothing is deleted. `isArchivedListing()` (`backend/trpc/lib.ts`) is the one definition.
- `listing.feed { archived: true }` (public) returns the Archive: archived listings, newest first (same ordering, Hottest and cursors as the live feed; same category/size/price/search filters; `pickupToday` is ignored). `archived: false` (default) is the unchanged live feed. Sold, removed and held (`reserved`) listings are in neither.
- An archived listing stays interactive: `listing.setLike`/`recordShare` work on `active` or `expired` listings; `listingComment.add` is open on `active`, `reserved` and `expired`. Offers and instant booking (`reservation.book`) stay live-listing only (CONFLICT).
- **Buyer-proposed meetup.** `reservation.request { listingId, startsAt, spotId | customAddress }` now accepts an archived listing. The buyer sets the time and place, so the seller's original windows and spots do not apply: any **active campus meetup spot** (BAD_REQUEST otherwise) or a custom address (the existing campus-radius check), and a time on the 15-minute grid that is in the future and within `ARCHIVE_REQUEST_HORIZON_MS` = **7 days**. It creates a `requested` reservation proposed by the buyer; the seller then `reservation.accept`s (the meetup is confirmed, the listing becomes `reserved`, handoff code issued) or `reservation.decline`s; `counter` still works. Accepting an archived request is allowed (the old "no longer available" refusal now applies only to sold, removed or held listings). A request alone never holds the listing; one open request per buyer per listing; blocks, the campus-email gate and the double-booking guard apply as before. If the confirmed meetup is cancelled or lapses, `releaseListing` returns the listing to `expired`, i.e. back into the Archive. Live listings keep their old rules (seller windows and spots).

**Posts stay up.** Community text posts no longer expire: `liveFilter()` is just `removed_at IS NULL`; `expiresAt` is NULL for new posts, never read, and no longer returned by `community.feed`/`byId`/`create`/`user.posts`/`user.comments`. Only the author (`community.remove`) or a moderator takes a post down. A listing's automatic Community post follows its listing: visible while the listing is `active` or `expired` (so archived listings keep their post and its likes and comments), hidden once it is sold, held by a confirmed meetup, or removed. **Posting brake**: `COMMUNITY_MAX_POSTS_PER_DAY` = 5 new text posts per person per rolling 24 hours (removed posts count, so delete-and-repost cannot dodge it; automatic listing posts never count). Retention: nothing here deletes data on a timer, which the privacy policy's retention wording must reflect (see `docs/LEGAL-TODO.md`).

Tested by `npm run test:archive` (43 checks).

