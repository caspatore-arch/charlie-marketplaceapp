# Design system

Feel: a contemporary campus resale brand — clean, fashion-conscious, warm, social. Big photos, confident type, restrained color, generous space. Not a dashboard, not enterprise, no gradients-for-decoration, no fake popularity counters.

## Tokens (`constants/theme.ts`)

```ts
colors: {
  bg: '#FAF8F5',          // warm off-white page ground
  surface: '#FFFFFF',
  surfaceMuted: '#F1EDE7',
  ink: '#161513',         // primary text
  inkMuted: '#6F6A62',
  inkFaint: '#A8A29A',
  line: '#E6E1DA',
  accent: '#C8442B',      // brick — brand + primary CTA (readable on white ≥ 4.5:1 with white text)
  accentSoft: '#FBE9E4',
  success: '#2E7D4F', successSoft: '#E4F3EA',
  warning: '#9A6B00', warningSoft: '#FBF1D6',
  danger:  '#B3261E',
  demo:    '#5B4FCF', demoSoft: '#ECEAFB',   // "Demo" badge
}
radius: { sm: 8, md: 14, lg: 20, pill: 999 }
space: 4-pt scale: 4, 8, 12, 16, 20, 24, 32, 40
type: system font (SF). Sizes: display 34/700 (tight letterspacing -0.5), title 22/700, heading 17/600, body 16/400, label 14/500, caption 12/500. Prices: 17/700 tabular-nums.
shadow: one soft card shadow only (ios: opacity .06, radius 12, offset y4)
```

Dark mode: not required for MVP; keep light palette, respect `userInterfaceStyle: light`.

## Primitives (`components/ui/`)

`Screen` (safe-area + bg), `Text` (variant prop), `Button` (primary / secondary / ghost / danger; sizes md, lg; loading + disabled; min touch height 48), `Chip` (selectable filter pill), `Badge` (`demo`, `verified`, `status`), `Card`, `Input` + `TextArea` (label, helper, error, keyboard type), `Sheet` (bottom sheet using Modal), `EmptyState` (icon, title, body, action), `Skeleton`, `ErrorState` (message + retry), `Avatar`, `PriceText`, `Divider`.

## Feature components

`ListingCard` (2-col grid: 4:5 photo, price bold, title 1 line, condition · size, tiny seller avatar; "Today" pill when pickup available today; "Demo" badge when `isDemo`), `PhotoGallery` (horizontal paging, dots, pinch not required), `SellerRow`, `SpotPicker` (list with name + precise description + hours note), `TimeSlotPicker` (chips for windows on a chosen day, 30‑min steps), `MeetupCard` (the signature: photo thumb, title, agreed price, spot name + description, static map tile placeholder with pin, local time, status pill, directions button, reschedule/cancel), `ReservationStatusPill`, `MessageBubble`, `FeeBreakdown` (labeled "Simulated — no money moves").

## Screens

Tabs: **Browse · Sell · Inbox · Profile** (lucide: `search`, `plus-circle`, `message-circle`, `user`).

- **Browse**: campus name header, search-less for MVP; filter row (category chips, price, size, "Pickup today" toggle); 2-col grid; pull-to-refresh; infinite scroll; skeletons; empty state.
- **Item detail**: gallery, price + title, condition/size/brand rows, description, "Pickup" section (spots + next available windows), seller row → profile, sticky bottom bar: `Request meetup` (primary) + message icon + save icon. Seller sees `Edit` / reservation requests instead. Share via `Share.share`.
- **Request meetup** (sheet or route): pick spot → pick time → optional note → `Send request`. Shows fee breakdown labeled simulated.
- **Sell** (create/edit): photos first (picker, progress, reorder by long-press optional), title, category chips, condition, price, size/brand optional, description, pickup spots multi-select, availability windows (add day + start/end), "Sell today" toggle with 24‑h expiry explanation, `Publish`. Validation inline. Keyboard-avoiding.
- **Inbox**: two segments — Messages, Requests (reservations with status pills). 
- **Meetup card** (`reservation/[id]`): as above. Buyer sees handoff code; seller has `Enter code` field. Both have `Confirm handoff`. Cancelled/complete states explicit.
- **Conversation**: bubbles, composer, reservation summary strip at top when one exists.
- **Profile**: avatar, name, campus, `Campus email verified` badge (copy: "Verified @arizona.edu email — not an identity check"), active listings grid, Saved, Blocked users, Sign out. Dev: "Switch test user" (only when DEV_LOGIN).
- **Auth**: email → code screen; explains code is printed to the server log in this prototype.

## Rules of copy

- "Demo" badge on anything `isDemo`. Demo spots say "verify before pilot".
- Never say "guaranteed", "protected", "paid". Fee screen says "Simulated — no money moves".
- Verification badge = "Campus email verified", never "Verified identity".
- Errors are human: "This item was just reserved by someone else."

## Accessibility

`accessibilityRole`/`Label` on tappables, ≥48pt targets, 4.5:1 text contrast, respect `AccessibilityInfo.isReduceMotionEnabled` (skip animations), Dynamic Type via `allowFontScaling` default on.

## Trust signals (added after the sections above; nothing earlier was rewritten)

`components/TrustSignals.tsx` renders the derived reputation summary from `user.trustSummary`
(docs/CONTRACT.md "Trust summary"). It reports **history, not an endorsement** — see the hard copy
rules below before touching this component's text.

- `<TrustBlock summary={...} />` — full block, `Card` primitive, used on the profile screen
  (`app/user/[id]`) below the header/bio. Rows (member since, handoffs completed with a seller/buyer
  breakdown, active listings, cancellations) each pair a small `lucide-react-native` icon with a text
  label — icons are decorative next to text, not icon-only tappables, so they carry no separate
  accessibility label. Ends with one plain-language line of honest framing (what the numbers do and
  don't mean) and, for `isDemo` accounts, an explicit "Demo account — this history is sample data"
  note in `colors.demo`, on top of (not instead of) the existing `<Badge kind="demo" />` elsewhere on
  the screen.
- `<TrustCompact summary={...} />` — one caption-sized line for the listing detail seller row: just
  handoffs completed + member since, the two most decision-relevant figures. Everything else in the
  full block is deliberately left out here so the seller row stays scannable.
- Both components render real zeros rather than omitting the section — a brand-new account is not
  made to look suspicious ("0 handoffs completed" is stated plainly, not hidden), and a
  heavily-used one is not made to look endorsed by the platform.
- `isClosed: true` collapses either component to a single neutral line ("This account is closed" /
  "Account closed") instead of numbers, so a closed account's history never renders even indirectly.

### Copy rules for trust signals (non-negotiable, in addition to "Rules of copy" above)

- Never imply the platform vouches for a person. Do not use "safe", "trusted", "verified seller",
  "protected", "guaranteed", or similar anywhere near these numbers.
- "Campus email verified" (the existing `Badge kind="verified"`) is never identity verification and
  must never be placed or worded so a reader could conclude otherwise — trust-signal copy must not
  blur into it (e.g. never say "verified" about a handoff count).
- State counts as plain facts ("12 handoffs completed", "Member since Sep 2026"), never as praise or
  a warning.

## Responsive layout (added when the MVP became web-first; nothing earlier was rewritten)

The app is designed phone-first at 390px. It now also ships as a website that must hold up in
mobile Safari and in a desktop browser, so `constants/theme.ts` carries two more tokens.

`breakpoints` — `sm: 390` (standard phone), `md: 600` (large phone / split-view tablet pane),
`lg: 768` (tablet portrait / small laptop window), `xl: 1024` (laptop / wide browser). Only `lg`
is load-bearing today: it is the single line between "phone layout" and "desktop layout".

`maxContentWidth` — `860`. Above `breakpoints.lg`, content sits in a centred column capped at this
width instead of stretching. 860px fits a three-column product grid at roughly 260px per card plus
`space.lg` gutters, and keeps text-heavy screens at a readable line length. Without the cap, a
1440px monitor rendered the two-column grid as two 720px columns each holding one small photo.

Rules:

- **Below `lg`, the rendered output must be identical to the phone layout.** A phone must never gain
  a margin, a wrapper that breaks the `flex: 1` scroll chain, or a changed safe-area edge because of
  a desktop style. Desktop styles are added conditionally, never applied and then overridden.
- **Read width from `useWindowDimensions`, never `Dimensions.get()`.** A desktop user resizes the
  window; `Dimensions.get()` freezes the width the app started at (see the note in
  `components/PhotoGallery.tsx`).
- **A `FlatList` whose `numColumns` can change needs a `key` containing the column count.** React
  Native cannot change `numColumns` on a mounted list; the key forces a clean remount on resize.
- **Centring an absolutely-positioned bar needs `marginHorizontal: 'auto'`, not `alignSelf`.** CSS
  ignores `align-self` on an absolutely-positioned element. The bottom tab bar is positioned, so it
  is centred with auto horizontal margins against its `maxWidth`.
