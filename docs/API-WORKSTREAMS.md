# Workstream API summary (for UI work)

Server is done and tested (`npm run test:workstreams`). All procedures below exist in
`backend/trpc/routes/*`. Types in `types/index.ts`. Errors are human-readable — show
`err.message` verbatim.

## Gates
- `campusVerifiedProcedure`: listing.create/relist, offer.create, reservation.book/request,
  community.create → FORBIDDEN "Verify your campus email to buy, sell, or post…" for phone-only
  accounts (`user.campusEmailVerifiedAt == null`). Read paths stay open.

## Offers (replace auctions — no bids, no auction timers, no rankings)
- `offer.create({ listingId, amountCents, message? })` buyer; amount ≥ $1 and < asking price.
- `offer.accept({ id })` seller → status `accepted`, `holdExpiresAt` = now+1h (or listing expiry).
  Item is held for that buyer to book; nobody else can book meanwhile.
- `offer.decline({ id, reason? })` seller. `offer.withdraw({ id })` buyer.
- `offer.forListing({ listingId })` → `{ viewerRole, offers[], heldUntil, heldByViewer, heldByOther }`
  (seller sees all, buyer sees own). Each offer has `listing` card, `buyer`, `seller`.
- `offer.mine({ role? })` → offers made/received, decorated.
- Status: pending | accepted | declined | withdrawn | expired | booked. `closeReason` explains.
- `bid.place` / `bid.buyout` now always throw PRECONDITION_FAILED (stale clients). Remove all
  auction UI (`components/auction/*`, `SaleTypeSelector`, bid feeds, countdowns, auction copy).
- `listing.create` no longer accepts auctions; `saleType` should be omitted.
  Legacy rows can still have `saleType === 'auction'` for < 24h: show the asking price
  and the message "This was posted as an auction… closes at its original end time." with no
  offer/book actions.

## Booking (exact slot + campus place)
- Meetups are 30-minute slots on :00/:30 (`MEETUP_SLOT_MINUTES`). Times are stored as UTC and
  must be DISPLAYED in the campus timezone (`slots.timezone`, e.g. America/Phoenix).
- `listing.create` requires `windows` (1–8), each inside now → now+24h, each ≥ 30 min.
  `listing.update({ windows })` same rule against the listing's own expiry.
- `reservation.slots({ listingId })` (public) → `{ open, closedReason, timezone, slotMinutes,
  expiresAt, spots: MeetupSpot[], slots: { startsAt, available, reason: 'seller_busy'|'you_busy'|null }[] }`
- `reservation.book({ listingId, spotId, startsAt, offerId?, expectedPriceCents? })` → ReservationDetail
  with `status: 'accepted'` (final). Price = asking price, or the viewer's accepted offer while held.
  Pass `expectedPriceCents` = the price you showed on the confirm step. Idempotent on re-submit.
  CONFLICTs: slot taken, item booked, availability changed, price changed, expired listing.
- `reservation.history({ id })` → events (`booked`, `requested`, `accepted`, `rescheduled`,
  `cancelled`, `completed`, `expired`, `imported`) oldest first.
- Reschedule = existing `reservation.counter` (now requires aligned future time) + `accept`.
  Cancel = `reservation.cancel`. Both update availability and texts automatically.
- `reservation.byId` stays available after the listing expires (confirmed meetups are durable).

## Community (replaces the Inbox tab)
- `community.feed({ kind?, cursor?, limit? })` (signed in, own campus) →
  `{ items: { id, kind: 'buying'|'selling', body, createdAt, expiresAt, author: PublicUser, isMine }[], nextCursor, serverNow }`
- `community.create({ kind, body })` body 3–280 chars; max 5 live posts per person.
- `community.remove({ id })` own post. `community.report({ id, reason, details? })`.
- Posts expire exactly 24h after creation; show "Xh left".
- Messages stay: `conversation.*` unchanged; reachable from listing ("Message seller") and from
  a meetup. The old inbox list moves off the tab bar.

## Phone sign-in / account
- `auth.requestPhoneCode({ phone })` → `{ simulated, resendAfterSeconds: 30, expiresInSeconds: 600 }`.
  TOO_MANY_REQUESTS for cooldown / hourly cap (message says how long).
- `auth.verifyPhoneCode({ phone, code, displayName?, campusId?, smsOptIn? })` →
  `{ status: 'needs_profile' }` (new number: ask name + campus (campus.list) + SMS consent
  checkbox, unchecked by default, then call again with the same code) or
  `{ status: 'signed_in', token, isNewAccount, user }`.
- Signed in: `auth.requestEmailLinkCode({ email })` + `auth.confirmEmailLink({ email, code })` →
  `{ switchedAccount, token|null, user }`. If `switchedAccount`, store the new token (the
  person's existing email account now has the phone; the empty phone account was retired).
- Signed in: `auth.requestPhoneLinkCode({ phone })` + `auth.confirmPhoneLink({ phone, code, smsOptIn? })`.
- `user.contactSettings()` → `{ phone, phoneVerified, email, campusEmailVerified, smsOptIn, … }`.
- `user.updateSmsPreferences({ smsOptIn })`.
- Email sign-in (`auth.requestCode`/`verifyCode`) still works ("Use campus email instead").
- Copy: phone verification ≠ campus verification ≠ identity verification. SMS and email codes are
  simulated in development (printed to the server log).

## Push preferences
- `notification.updatePreferences({ messages?, meetups?, offers? })` — `auctions` is legacy.
