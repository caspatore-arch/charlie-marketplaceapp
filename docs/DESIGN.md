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
