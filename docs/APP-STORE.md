# Shipping to TestFlight and the App Store (for the founder, not an engineer)

This is the sequel to `docs/DEPLOY.md` (how the **backend** is hosted and operated; it
is already live on Render). This document is about the **iPhone app itself** — how it
gets onto your phone and a tester's phone through TestFlight, and eventually
onto the public App Store.

Read `docs/LEGAL-TODO.md` first. Four items in it — a hosted privacy policy,
the App Privacy questionnaire, the age rating, and a support contact —
**block submission**, not just "should do eventually." This document assumes
those are handled and focuses on the app-store-specific mechanics.

---

## 0. Two things this document will not do

1. **Pick your bundle identifier.** That one is still your decision — see
   `app.config.ts` for exactly what to change and why. The bundle identifier
   **cannot be changed after your first submission to Apple**, so decide it
   deliberately, not in a hurry. (The app *name* is already decided — it is
   **Dibbs** — but that does not settle the bundle identifier, which is a
   separate, permanent choice.)
2. **Run a build or submit one for you.** This Mac has no Apple Developer
   account, no Xcode, and no registered EAS project. Every `eas` command
   below is something *you* run, the first time, from a terminal — not
   something already done.

---

## 1. Sign up for the Apple Developer Program

- Go to [developer.apple.com/programs](https://developer.apple.com/programs/enroll/).
- **Cost: $99/year**, billed annually, renews every year you want to keep
  distributing the app (TestFlight and the App Store both require an active
  membership; letting it lapse pulls the app down).
- You'll enroll as an **Individual** or an **Organization** (a real, legally
  registered business with a D‑U‑N‑S number). Individual is faster (usually
  approved within a day or two); Organization is slower to set up but shows
  your company's name instead of your personal name as the seller. This is a
  business decision, not a technical one — pick based on whether you're
  incorporated yet.
- **Time:** typically same-day to a few days for approval. Budget a week to
  be safe in case Apple asks for more verification.
- Once approved, you'll be able to find three IDs you'll need later (see §4):
  your **Apple ID** (the email you enrolled with), your **Team ID** (found at
  [developer.apple.com/account](https://developer.apple.com/account) under
  Membership), and your **App Store Connect App ID** (created once you make
  the app record in App Store Connect, step §3).

---

## 2. What `eas build` and `eas submit` actually do

This project uses **EAS** (Expo Application Services) — Expo's own cloud
build service. You do not need a Mac with Xcode to build an iOS app; EAS
builds it on Apple hardware in the cloud and hands you a file.

Three build profiles are set up in `eas.json`:

| Profile | Command | What it's for |
|---|---|---|
| `development` | `eas build --platform ios --profile development` | A build with the Expo "dev client" baked in, so you can install it once and then get live code updates from `npm start` without rebuilding every time. Distributed internally (not through the App Store). |
| `preview` | `eas build --platform ios --profile preview` | A real, installable build for internal testers — the TestFlight-style path. Distributed internally, no App Store review needed. |
| `production` | `eas build --platform ios --profile production` | A store-ready build. Auto-increments the invisible internal build number each time, so you never have to remember to bump it. This is the build you eventually run `eas submit` against. |

`eas build` produces an `.ipa` file and uploads it to Apple for you if you
ask it to (`--auto-submit`), or you can submit separately:

```
eas submit --platform ios --profile production
```

`eas submit` takes an already-built `.ipa` and uploads it to **App Store
Connect** — Apple's dashboard for managing your app, its metadata, and its
releases. It does not publish anything publicly by itself; it just gets the
build into Apple's system where it shows up in TestFlight and, later, can be
submitted for App Store review.

**Neither command has been run from this machine.** There is no EAS project
connected to this repo yet — the very first `eas build` will prompt you to
log into an Expo account and create one (it will ask to modify `eas.json`
with a generated `extra.eas.projectId`; that's expected and safe to accept).

---

## 3. TestFlight

TestFlight is Apple's built-in beta-testing tool — it's how you get the app
onto a friend's or fellow student's iPhone before (or without ever) going
through full App Store review.

1. In [App Store Connect](https://appstoreconnect.apple.com), create a new
   app record (My Apps → +) using the bundle identifier you chose in
   `app.config.ts`. This is where you get the **App Store Connect App ID**
   (`ascAppId`) that `eas.json`'s `submit.production.ios` block needs.
2. Run `eas build --platform ios --profile preview` (or `production` — both
   work for TestFlight), then `eas submit --platform ios`.
3. Once Apple finishes processing the build (usually 15–60 minutes, you'll
   get an email), it appears under the **TestFlight** tab in App Store
   Connect.
4. **Internal testers** (up to 100 people, must be added as users on your
   Apple Developer account) get access immediately, no review needed. This
   is the fastest path — good for you and a handful of collaborators.
5. **External testers** (up to 10,000 people, just need an email/invite
   link) require a **one-time "Beta App Review"** by Apple — lighter than
   full App Store review, typically 24–48 hours, but it's a real review: the
   app needs to actually work and the four blocking items from
   `docs/LEGAL-TODO.md` should already be true by this point, especially the
   hosted privacy policy URL (App Store Connect will ask for it before you
   can even submit for external testing).

**Cost:** no extra cost beyond the $99/year Developer Program membership.

---

## 4. `eas.json` — what's already set up, and what you must fill in

`eas.json` (repo root) has the three build profiles above, plus a `submit`
section scaffolded for iOS with three placeholders that **must never be
guessed** — they are yours and do not exist yet:

```json
"submit": {
  "production": {
    "ios": {
      "appleId": "REPLACE_ME_APPLE_ID_EMAIL",
      "ascAppId": "REPLACE_ME_APP_STORE_CONNECT_APP_ID",
      "appleTeamId": "REPLACE_ME_APPLE_TEAM_ID"
    }
  }
}
```

| Placeholder | What it is | Where to find it |
|---|---|---|
| `appleId` | The email address of your Apple Developer account | The email you enrolled with in §1 |
| `ascAppId` | App Store Connect's numeric ID for this specific app | Shown on the app's page in App Store Connect once you create the app record (§3, step 1) — labeled "Apple ID" there, confusingly (not the same as your personal Apple ID) |
| `appleTeamId` | Your 10-character Developer Team ID | developer.apple.com/account → Membership |

Until you fill these in, `eas submit` will simply prompt you for them
interactively instead of failing silently — so this is a convenience to fill
in later, not a hard blocker to get a build going.

---

## 5. Drafted App Store listing (edit before you use it)

Everything below is a first draft for you to edit — none of it should be
treated as final copy. The brand name is decided, so it appears as **Dibbs**
throughout.

> **Name:** Dibbs
>
> **Subtitle** (30 characters max): `Buy & sell with your campus`
>
> **Promotional text** (170 characters, can be updated anytime without a
> new build): `A secondhand marketplace for your campus community. Message a
> seller, agree a time and place, meet up in person.`
>
> **Description:**
>
> Dibbs is a secondhand marketplace built for your campus. Browse
> listings from other verified-campus-email students, message a seller
> directly, and agree on a time and place to meet up in person.
>
> - Browse and search listings by category, size, and condition
> - Message sellers and buyers directly in the app
> - Agree on a meetup time and a safe, public location — either a curated
>   campus spot or an address you choose together
> - Simple handoff confirmation when the item changes hands
> - Report or block another user at any time
>
> Dibbs connects you with other members of your campus email
> community, but it does not verify anyone's identity, and it does not
> process or protect payment for items — buyers and sellers arrange payment
> and the handoff themselves, in person. Always meet in a public place.
>
> **Keywords** (100 characters, comma-separated, not shown to users):
> `campus,secondhand,marketplace,student,resell,thrift,dorm,college,buy,sell`
>
> **Support URL:** `[FOUNDER TO CONFIRM — a real, working page or email
> landing page; Apple checks this]`
>
> **Marketing URL** (optional): `[FOUNDER TO CONFIRM — can be left blank]`

### What NOT to say, and why (do not edit this section into something that violates it)

This draft deliberately avoids specific claims that the app does not back
up, per the project's own honesty rules:

- **Never call payments "real," "protected," "guaranteed," or "safe."**
  Payments are entirely simulated right now (`docs/HANDOFF.md` §3, §3a) — no
  Stripe key exists, nothing can charge anyone. If real payments are ever
  turned on, re-read `docs/HANDOFF.md` §3a's "Before real money" section
  before writing a single word of marketing copy about them; even then, the
  permitted framing is narrow ("you pay now; the seller is paid right away"
  — not "protected" or "escrow").
- **"Campus email verified" is not identity verification**, and this draft
  never implies otherwise. Do not add language like "verified users,"
  "trusted community," or "background-checked" — none of that is true. The
  app confirms someone can receive mail at a `.edu`-style address in
  `ALLOWED_EMAIL_DOMAINS`; it confirms nothing about who they actually are.
- **Do not promise safety the app doesn't deliver.** It's fine, and honest,
  to say the app *suggests* public meetup spots and *lets* users report or
  block each other. It is not fine to say the app *ensures* safe meetups —
  it can't, and a reviewer or a bad interaction would make that a real
  liability, not just a marketing overstatement.

---

## 6. App Privacy ("nutrition label") — drafted from what the app actually collects

Apple requires you to fill this in inside App Store Connect (App
Privacy section) before submission. This table is derived directly from
`backend/db/schema.ts` — the actual database — not guessed. Verify it
still matches if the schema changes before you submit.

| Data type | Collected? | Linked to identity? | Used for tracking? | Where it lives / notes |
|---|---|---|---|---|
| Email address | Yes | Yes | No | `users.email` — used for sign-in only, never shown publicly |
| Name (display name) | Yes | Yes | No | `users.displayName` — shown publicly on listings/profile |
| Photos | Yes | Yes | No | `listingPhotos.url`, `users.avatarUrl` — listing photos and profile picture, user-submitted |
| Physical address / approximate location | Yes | Yes | No | `reservations.customAddress` / `customLat` / `customLng` — a meetup location the two parties in a specific deal choose or type in; **not** the user's home address, and **not** continuous or background location — the app never reads device GPS |
| Device ID / push token | Yes | Yes | No | `deviceTokens.expoPushToken` — used only to deliver push notifications about messages/meetups/auctions the user opted into; see `notificationPreferences` |
| User content (messages) | Yes | Yes | No | `messages.body` — needed for the app's core purpose (buyer/seller chat) |
| Payment info | **Not collected by this app** | — | — | Stripe Connect handles all card data; this app's database stores only `payments.amountCents`, `feeCents`, and Stripe's own reference IDs (`stripePaymentIntentId`, `stripeChargeId`) — never card numbers. **Currently inactive**: no Stripe key exists, so no real payment ever occurs (`docs/HANDOFF.md` §3) |
| Precise location (GPS) | No | — | — | Not requested from the device at all |
| Contacts | No | — | — | Not accessed |
| Browsing/search history sent to third parties | No | — | — | — |
| Analytics / advertising data | No | — | — | No analytics or crash-reporting SDK is wired up (matches `ANALYTICS_THIRD_PARTIES` in `constants/legal.ts`, currently `[FOUNDER TO CONFIRM]` — the honest current answer is "none," but this table and that constant must be updated together the moment one is added) |

None of this data is used for **tracking** (Apple's specific definition:
linking user/device data across other companies' apps/websites for
advertising) — nothing here does that.

---

## 7. App Review guidelines this app will actually be checked against

### 5.1.1(v) — Account deletion

Apple requires apps with account creation to offer in-app account deletion,
not just deactivation. **This is already implemented.** Verified in
`backend/trpc/routes/user.ts` (search for the `deleteAccount` mutation — its
exact line number moves as the file changes): it anonymizes the user (wipes display name → "Deleted user", email, avatar,
bio), deletes their sessions, saved listings, and blocks, and is reachable
from the app's Settings screen. Read `docs/HANDOFF.md` §3 "Account closure"
before relying on this for a review response: it is **anonymization, not
full erasure** — message history, reports, and completed sales are kept.
That's very likely fine for 5.1.1(v) (Apple's requirement is about the
account and personal data tied to it, and this does anonymize the personal
fields), but it is not a guarantee against a reviewer who reads closely; be
ready to explain the distinction if asked.

### 1.2 — User-generated content

Apps with UGC and person-to-person interaction need a way to report
objectionable content and block abusive users. **Both are already
implemented.** Verified in `backend/trpc/routes/user.ts`: `report` (reports
land in the `reports` table with a reason, reviewable by a moderator) and
`block` / `unblock` (blocked users' listings disappear from the blocker's
feed). There's also a dedicated moderation screen
(`backend/trpc/routes/moderation.ts` + the in-app Moderation screen reachable
by a `MODERATOR_USER_IDS` account) that can dismiss a report, add a note, or
remove a listing outright. Make sure at least one real person is checking
that queue before you have real users — nothing technical enforces that,
(`docs/PROJECT-DIRECTIVES.md` lists moderation ownership as a pilot-operations decision).

### No in-app purchase required

This app sells **physical, secondhand goods** with the handoff happening
**in person, outside the app** (Guideline 3.1.5(a) exempts this — physical
goods and services consumed outside the app don't need Apple's in-app
purchase system, unlike digital goods/subscriptions). The Stripe payment
flow (currently inactive — see §6) is a direct card charge for a physical
item, not a digital unlock, so it does not need to route through Apple's
IAP either. If the app ever adds anything digital (e.g. a paid "featured
listing" boost), that specific feature would need IAP — the physical resale
transactions would not.

### Safety scrutiny to expect

This is a marketplace that arranges **in-person meetups between strangers**,
which is exactly the kind of feature Apple reviewers look at harder than
average — expect questions or a request for a demo account during review.
Be ready to show, live if asked: the meetup-spot suggestions (curated campus
locations shown before a free-text address), the "a bid is a commitment to
buy" and payment-simulation disclosures, the report/block flow, and the age
self-declaration at sign-up. None of these *guarantee* safety — say so if
asked, don't oversell it (see §5's "what not to say") — but they show the
app took the risk seriously, which is usually what a reviewer is actually
checking for.

---

## 8. Before you submit for real — a short checklist

- [ ] `app.config.ts`'s `DISPLAY_NAME` reads the decided brand name, **Dibbs**
      (no `(dev)` suffix on a store build).
- [ ] `app.config.ts`'s `BUNDLE_IDENTIFIER` changed from its placeholder to
      your real, final choice (it cannot change after this point). Still
      undecided — the brand name being settled does not settle this.
- [ ] Every item in `docs/LEGAL-TODO.md`'s "What specifically blocks App
      Store submission" section resolved: hosted privacy policy URL, App
      Privacy questionnaire (§6 above is your starting draft), age rating,
      support contact.
- [ ] `eas.json`'s `submit.production.ios` placeholders filled in with your
      real `appleId`, `ascAppId`, `appleTeamId` (§4).
- [ ] `assets/icon.png` still 1024×1024 with no alpha channel if it's ever
      regenerated (verified as of this writing — see the report that
      accompanied this document).
- [ ] The App Store listing draft in §5 reviewed against the "what NOT to
      say" rules before you paste it into App Store Connect.
- [ ] `docs/HANDOFF.md` §3's "Simulated or unfinished" table re-read in
      full — none of the App Store work above turns any of those items on.
