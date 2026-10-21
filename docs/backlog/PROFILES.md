# Backlog: revisit profiles (exploratory)

Status: **exploratory backlog. Not for implementation now. No scheme is chosen.**

## Idea
Revisit profiles, possibly with category-based subtitles or labels, for example:
- "Mostly sells: dorm & tech"
- "Sneaker seller"
- "Mostly buys: books"

## Options (not decisions)
1. No labels; keep the current trust summary only.
2. Derived labels from real listing categories (for example the top category over completed sales).
3. Seller-chosen subtitle (free text or from a short list), moderated.
4. A combination: derived label plus optional seller-written line.

## Constraints that already exist
- `docs/CONTRACT.md` "Trust summary": reputation is **derived only from real history** (`reservations`, `listings`, `users`). There is no ratings system and no user-submitted score. No fabricated signals, no padding for new accounts.
- Phone verification is not campus verification, and neither is identity verification. Any label or badge must not blur them.
- `docs/DESIGN.md` "Trust signals" copy rules apply.

## Decisions needed
- Which scheme (above), if any. Do not choose a reputation or identity scheme here.
- Minimum history before a derived label appears (for example N completed sales) and how it is worded when there is not enough.
- Category taxonomy: reuse listing categories or group them.
- Who can see it; can a user hide it; how it is moderated and reported.
- How it interacts with closed or demo accounts.
- Whether labels could encourage category gaming or discriminate.

## Dependencies
- Booking history: completed reservations are the only honest source for "sells/buys" signals.
- Verification state (phone, campus email) for what badges accompany a label.

## Not in scope
Ratings, reviews, scores, identity verification, or any new tables.
