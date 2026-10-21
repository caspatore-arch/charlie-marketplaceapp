# Rork publish prompts

Paste-ready prompts for handing this repo to Rork (rork.com). Prompt 1 gets
Rork holding the real code. Prompt 2 is the design polish pass. Prompt 3 is
the release build and store submission.

**Do them in order, and don't start prompt 3 until the backend from
`docs/DEPLOY.md` is live** — a submitted build points at a fixed API address,
and Apple reviewers will open the app on a device that is not on your Wi-Fi.

Facts Rork needs are baked into the prompts below. Keep them: they stop Rork
from "helpfully" rewriting the parts that are already correct.

---

## Prompt 1 — get the repo into Rork

> I have an existing Expo app (SDK 57, expo-router, React Native 0.86) in a
> GitHub repo. It was generated to match Rork's own project layout: `app/` for
> screens, `components/`, `constants/`, `hooks/`, `lib/trpc.ts`,
> `backend/hono.ts` and `backend/trpc/` for the API, and it reads its API
> address from `EXPO_PUBLIC_RORK_API_BASE_URL` with tRPC served at
> `/api/trpc/*`.
>
> Please create a new blank Rork project, connect it to GitHub, and tell me
> the repo URL you create so I can push my existing code into it. I want
> two-way sync: I keep editing locally, you edit in Rork, both land in the
> same repo.
>
> Do not scaffold a new app or sample screens — the app is complete and I am
> importing it, not starting it. Once my code is in, confirm you can build it
> and that the Browse, Sell, Inbox and Profile tabs render.

---

## Prompt 2 — design polish (safe to let Rork change things)

> This is a campus secondhand marketplace for students: buy and sell used
> items, then meet up on campus to hand them over in person. The app is called
> "Dibbs".
>
> Please do a visual design pass over the whole app. What I want improved:
>
> 1. **Visual identity.** A colour palette, type scale and icon style that
>    feels trustworthy and student-friendly, not corporate. Today's theme
>    lives in `constants/theme.ts` — change the token values there rather than
>    hardcoding colours in screens, so the whole app moves together.
> 2. **The Browse feed** (`app/(tabs)/index.tsx`, `components/ListingCard.tsx`).
>    The pickup time on each card is the most important thing on screen — it
>    answers "could I actually get this today?" — so keep it prominent.
> 3. **The swipe view** (`components/browse/SwipeDeck.tsx`): a card stack where
>    swipe right saves and swipe left skips. Make the cards, the SAVE/PASS
>    stamps and the three buttons underneath feel polished. Do not change what
>    the gestures do or remove the buttons — the buttons are the accessible
>    path for people who can't swipe.
> 4. **Empty, loading and error states** across every screen — they exist, but
>    they're plain.
> 5. **The listing detail and meetup screens** — these carry the trust moment,
>    where a stranger agrees to meet you. They should feel safe and calm.
> 6. **App icon and splash screen** in `assets/`.
>
> Rules, please:
> - Don't change any file under `backend/`, don't change the tRPC procedure
>   names or their inputs/outputs, and don't change `lib/trpc.ts`. The app and
>   API agree on a contract documented in `docs/CONTRACT.md` — breaking it
>   breaks the app silently.
> - Don't remove the "Demo" badges or the demo-data disclaimers. They are
>   deliberate: the pilot data is fake and users must be able to tell.
> - Don't add any analytics, crash reporting or third-party SDK. My App Store
>   privacy disclosures currently say "no third parties receive user data" and
>   I need that to stay true until I update the legal documents.
> - Keep every screen working at 390×844 (iPhone) with the keyboard open.

---

## Prompt 3 — release build and store submission

Only after `docs/DEPLOY.md` is done and you have a live API URL.

> The app is ready to ship as a first public release / TestFlight beta. Please
> take it through the build and submission process for me.
>
> Configuration I need set:
> - App name: **Dibbs**
> - Bundle identifier / package name: **[e.g. com.yourcompany.dibbs]** —
>   this can never change after the first submission, so use exactly this.
> - `EXPO_PUBLIC_RORK_API_BASE_URL` must be **[YOUR LIVE API URL, e.g.
>   https://api.yourdomain.com]** in the production build. It must not be a
>   localhost or 192.168.x.x address — an App Store reviewer's phone is not on
>   my Wi-Fi, so a LAN address means the app opens to an error and gets
>   rejected.
> - These are configured in `app.config.ts` — please change them there.
>
> Please also:
> 1. Register an EAS project for this app and give me the project id, so that
>    push notifications can work (the code is already written; it has never
>    had a project id).
> 2. Produce an iOS build and submit it to TestFlight first, not straight to
>    the App Store. I want a real-device pass before public release.
> 3. Walk me through what you need from my Apple Developer account, step by
>    step, and tell me exactly which values you need from me rather than
>    guessing them.
> 4. Tell me what you need for the App Store listing — screenshots, the
>    description, keywords, the support URL, the privacy policy URL — and
>    generate draft copy and screenshots I can review and edit. I have notes
>    in `docs/APP-STORE.md`.
> 5. For Apple's App Privacy questionnaire, use these answers: the app
>    collects email address and display name for account creation, messages
>    between users, and (if the user allows it) approximate location only to
>    show nearby campus meetup spots. No data is shared with third parties. No
>    tracking across apps. Flag anything in the code that contradicts this
>    rather than filing it anyway.
>
> Please do not enable any payment features in this submission. Stripe is
> written but has never run against a real account, and anything resembling
> in-app purchase of digital goods needs Apple's own payment system — ask me
> before touching that area.

---

## What Rork cannot do for you

No AI builder can open accounts in your name or accept legal agreements. See
the checklist in the chat answer, and `docs/DEPLOY.md`, `docs/APP-STORE.md`
and `docs/LEGAL-TODO.md` for the long versions.
