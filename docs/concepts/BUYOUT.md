# Concept: expiring-listing buyout (decision brief)

Status: **concept only, disabled, not integrated.** Integration requires a later, explicit instruction.

## What it is
Near a listing's 24-hour expiry, Dibbs would offer to buy a qualifying item from the seller at **25% of the posted asking price**. The seller can accept or decline. An accepted offer goes to **manual review**; nothing automatic happens after that.

## The 25% rule
The offer is 25% of asking, rounded with `Math.round` to the nearest cent.
- $100 listing -> **$25** offer (not $75)
- $40 listing -> $10
- $10.02 -> $2.51 (250.5 cents rounds up); $10.01 -> $2.50

## Why it is disabled
Every qualification rule is unresolved, and there is deliberately **no valuation model**: the price is only what the seller asked. Buying inventory also raises money, legal and operations questions that are not answered. The prototype lives in `prototypes/buyout/`, the hidden route `app/concepts/buyout.tsx` shows a disabled notice unless `EXPO_PUBLIC_ENABLE_CONCEPTS=1`, and no navigation links to it. It makes no network or tRPC calls and sends nothing.

## Decisions needed
1. **Which items qualify**: categories, minimum price, condition. Placeholder config only (`BuyoutConfig`).
2. **Exact trigger timing**: how long before expiry; one offer or several; what if the seller is mid-booking.
3. **Budget and inventory ownership**: who funds it, caps per day/campus, who legally owns the item, where it is stored.
4. **Pickup operations**: who collects, where, when; interaction with the existing meetup spots.
5. **Avoiding offers on held/sold items**: the live system must be checked at offer time and again at acceptance. Checks needed: `reservations` (accepted/completed/booked for the listing, including the slot state), `offers` with status `accepted` and an unexpired `holdExpiresAt` (a buyer holds the item), listing `status`, and listing expiry. Race: a buyer can accept or book while a buyout is pending, so acceptance must re-check atomically.
6. **Refunds and resale**: what happens if the item is not as described; how resale pricing and disclosure work.
7. **Seller communication and consent**: opt-in, wording (SMS rules, see the SMS workstream), no pressure, easy decline.
8. **Legal and tax**: dealer/reseller status, sales tax, record keeping, terms of service.

## Risks
- Sellers may read a 25% offer as a lowball and lose trust in the app.
- Adverse selection: sellers may list at inflated prices to harvest offers.
- Cash exposure with no valuation model.
- Double-sale if the hold/reservation checks are skipped.
- Looks like a reintroduced time-pressure mechanic after auctions were removed.

## What a later integration would touch
New backend procedure(s) and table(s) for buyout offers, a scheduled job near expiry, reads of `listings`, `offers`, `reservations`, notification/SMS hooks, a seller UI entry point, and an admin/manual-review surface. None of this exists or is started.
