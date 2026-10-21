# Backlog: map for campus meetup locations and booking

Status: **backlog only. Not for implementation now.**

## Goal
Let people see campus meetup spots on a map when choosing where to meet and when booking a slot.

## Reuse what exists
- `meetup_spots` records: lat/lng, name, description, `hoursNote`. No new location data model.
- Custom-address and geocoding work in `backend/geocode.ts` (read-only reference; it has a stub and a cache, and production would need a paid geocoder).
- Booking: `reservation.slots` (spots plus 30-minute slots, campus timezone) and `reservation.book`.

## Requirements
- **Accessibility**: the map is never the only way. A list of spots with name, description and hours is always available and is the default for screen readers; spots are selectable from the list. Labels, sufficient contrast, touch targets of at least 48pt.
- **Location permission only when needed**: never on launch. Ask only when the person taps something like "Near me", with a plain explanation first. The map must work with no permission.
- **Offline and denied states**: permission denied, location off, no network, tiles failing: fall back to the list with a clear message and no dead ends.
- **Web support**: the browser build must work too (decide a web-capable map approach; no new dependency chosen here).
- Show spot hours and respect that a slot is only bookable if the spot is open.

## Dependencies
- Booking (`reservation.slots/book`) is the integration point.
- Phone/campus verification: booking is campus-verified only, so the map must not imply a phone-only account can book.

## Acceptance criteria
- [ ] Every spot appears in both the list and the map; selecting either selects the same spot.
- [ ] Booking flow completes using the list alone with the map disabled.
- [ ] No location prompt appears at launch or on screens without a "near me" action.
- [ ] Denied permission, offline, and tile failure each show a usable fallback.
- [ ] Works on iOS, Android and web.
- [ ] Passes screen-reader and large-text checks.

## Open questions
- Which map provider and cost, and does it need an API key or new dependency?
- Do we show the user's own position, or only distance to spots?
- Do custom addresses (geocoded) appear on the map, or only campus spots?
- Privacy: do we ever store location? (Default: no.)
