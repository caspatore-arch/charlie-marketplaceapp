# Integration checklist (cross-workstream)

Commands: `npm run test:workstreams`, `npm run test:e2e`, `npm run typecheck`, `npx tsx scripts/buyout-concept-check.ts`.

## Automated (run first)
- [ ] `npm run typecheck` passes.
- [ ] `npm run test:workstreams` passes.
- [ ] `npm run test:e2e` passes.
- [ ] `npx tsx scripts/buyout-concept-check.ts` passes.

## 1. No auctions remain
- [ ] UI grep finds no auction UI: `grep -rniE "auction|bid|buyout|countdown" app components` (legacy-listing notice and the disabled concept are the only expected hits).
- [ ] `bid.place` and `bid.buyout` are refused (PRECONDITION_FAILED).
- [ ] `listing.create` with `saleType: 'auction'` is refused.
- [ ] Legacy auction listings still settle at their original end time and show the legacy notice with no offer/book actions.

## 2. Offers and booking agree
- [ ] Accepted offer price becomes the booking price (`reservation.book` with `offerId`).
- [ ] While an accepted offer holds the item (`holdExpiresAt`), other buyers cannot book.
- [ ] Two simultaneous accepts: exactly one wins, the other gets a clear conflict.
- [ ] `expectedPriceCents` mismatch returns a price-changed conflict.
- [ ] Hold expiry releases the item.

## 3. Expiry at 24 hours (server-enforced)
- [ ] Community posts expire exactly 24h after creation, enforced server-side (not just hidden in UI).
- [ ] Listings expire 24h after creation for every poster.
- [ ] Expired items cannot be booked or offered on.

## 4. Confirmed meetups outlive listing expiry
- [ ] `reservation.byId` works after the listing expires.
- [ ] `reservation.history` shows events for it.
- [ ] Meetup still appears in the user's meetups and can be cancelled or rescheduled.

## 5. Simple two-way messages
- [ ] "Message seller" from a listing opens a conversation and both sides can reply.
- [ ] Messaging works from a booking/meetup.
- [ ] Blocked users cannot message.

## 6. Browser onboarding shares accounts
- [ ] Browser and native app hit the same backend and users table.
- [ ] Phone sign-in on web and app yields the same account.
- [ ] Email-to-phone linking: `confirmEmailLink` switches to the existing email account when one exists (token replaced), and the empty phone account is retired.
- [ ] Phone-only accounts are blocked from buy/sell/post with the campus-verify message but can read.

## 7. SMS testable without live sends
- [ ] Default is the simulated adapter; codes print to the server log.
- [ ] `SMS_MODE` defaults to simulated; live requires `SMS_MODE=live`, Twilio credentials and `SMS_LIVE_ACK=1`.
- [ ] Tests always run simulated; no live send during `npm run test:workstreams`.
- [ ] Opt-in defaults unchecked; opt-out respected.

## 8. Concept and backlog items stay inert
- [ ] Buyout concept disabled: `/concepts/buyout` shows "This concept is disabled" without `EXPO_PUBLIC_ENABLE_CONCEPTS=1`, and nothing links to it (`grep -rn "concepts/buyout" app components` shows only the route file).
- [ ] No tRPC/backend references from `prototypes/buyout`.
- [ ] Maps and profiles exist only as docs: `docs/backlog/MAPS.md`, `docs/backlog/PROFILES.md`.
