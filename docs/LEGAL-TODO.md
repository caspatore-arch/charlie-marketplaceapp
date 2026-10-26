# Legal & eligibility to-do (read this before any real launch)

**This is not legal advice.** This checklist and the placeholder Terms/Privacy
text in `constants/legal.ts` were written by a non-lawyer founder (with AI
assistance) for a local prototype. Before onboarding real students, a lawyer
needs to review the final Terms of Service and Privacy Policy, and confirm the
age-gating and data-handling approach.

## Every `[FOUNDER TO CONFIRM]` marker, in one place

These live in `constants/legal.ts` and are rendered verbatim inside the
Terms and Privacy screens (`app/legal/terms.tsx`, `app/legal/privacy.tsx`) so
they're impossible to miss while reading the document.

| Marker | What it means | Why it matters |
|---|---|---|
| `MINIMUM_AGE` (currently `18`) | The age a user self-declares at sign-up. | **Blocks App Store submission indirectly** — it drives the app's age rating and disclosure requirements. Under 13 triggers COPPA (parental consent). Under 16 can trigger EU "GDPR-K" rules. This app arranges in-person meetups between strangers, so lowering it should not be done casually — get legal input first. |
| `LEGAL_ENTITY_NAME` | The legal name behind the app — a company, or the founder personally if unincorporated. | Needed in the Terms/Privacy so users know who they're agreeing with. Affects liability exposure — ask a lawyer whether to incorporate before real users. |
| `OPERATOR_CONTACT_EMAIL` | An email address for legal/privacy questions. | **Blocks App Store submission** — Apple requires a working support/contact method, and a privacy policy needs a real contact. |
| `GOVERNING_JURISDICTION` | Which state/country's law governs disputes. | Affects where a dispute would be resolved. Pick where the operator is based, then confirm with a lawyer. |
| `DATA_RETENTION_PERIOD` | How long account/message/transaction data is kept after account closure. | **Blocks App Store submission** — Apple's App Privacy questionnaire and the privacy policy both need a real answer, not "forever" by default. |
| `ANALYTICS_THIRD_PARTIES` | Which analytics, crash-reporting, or other third-party services the app uses. | **Blocks App Store submission** — Apple's "App Privacy" (nutrition label) disclosures require listing every third party that receives user data. Currently none are wired up, so today's honest answer is "none," but this must be revisited the moment one is added. |
| `DATA_DELETION_CONTACT` | How a user requests full data deletion beyond what "Close account" already does. | Account closure in this prototype is anonymization, not erasure (message history and completed sales are kept — see `docs/HANDOFF.md` §3). A real deletion path/contact is required for a genuine privacy policy. |
| `LAST_UPDATED` | The date the document was actually reviewed. | Cosmetic but expected in any real Terms/Privacy document — don't leave it as a placeholder at launch. |
| Terms §7 "No warranties, limitation of liability" | Placeholder text — deliberately left as a marker rather than AI-generated legal boilerplate. | This is the paragraph that limits the operator's legal exposure. It needs a lawyer's actual wording, not text an AI assistant guessed at. |

## What specifically blocks App Store submission

Apple requires, before you can submit:
1. A **live, public URL** for the Privacy Policy (App Store Connect asks for
   this — today these screens only exist inside the app, not as a hosted
   web page).
2. An accurate **App Privacy** questionnaire (the "nutrition label") —
   depends on `ANALYTICS_THIRD_PARTIES` and `DATA_RETENTION_PERIOD` above
   being true, plus what's actually collected (see the Privacy Policy §2/§3).
3. An **age rating** for the App Store listing — depends on `MINIMUM_AGE`
   and on features like user-generated content, chat between strangers, and
   arranging in-person meetups, which typically push the rating up.
4. A **support contact** (`OPERATOR_CONTACT_EMAIL`).

None of these four are done yet. Items 2–4 are copy/config work once the
founder answers are in; item 1 needs the Terms/Privacy text hosted somewhere
public (even a simple static page) before App Store Connect will accept it.

## Decisions that are not legal, but are yours alone

These surfaced while building auctions, payments, custom meetup addresses and
notifications. None of them can be answered by an engineer or an AI assistant,
and each one is currently sitting on a default that was chosen to be *safe to
change*, not because it is right.

| Decision | Current default | Why it needs you |
|---|---|---|
| **Payout delay** (`PAYOUT_DELAY_DAYS`) | `0` — pay the seller as fast as Stripe allows | Payments use **direct charges**, so a dispute is drawn from the seller's Stripe balance rather than yours. At `0` that balance is normally empty by the time a dispute lands, Stripe pushes the seller's account negative, and Stripe's negative-balance rules put the loss back on **you**. `7` is the recommended pilot value. This is one number in `.env` and it is the difference between the seller being liable on paper and being liable in fact. |
| **Whether to take payments at all** | Built, but forced to simulated (no Stripe key) | Cash or Venmo at handoff removes card-dispute exposure entirely and needs no Stripe account. You lose the 10%. A pilot can learn whether students will meet and trade without processing a cent. |
| **Custom meetup addresses** | On, limited to 2 miles from campus | Curated campus spots are safer by design: public, lit, other people present. A custom address removes that guardrail, and there is **no verification that an address is a sane place to meet, no way to flag a bad one afterwards, and no support-side record** if something goes wrong there. Either accept that knowingly for the pilot or turn the option off until someone is answering reports. |
| **Bid enforcement** | A bid is described as a commitment; nothing enforces it | No deposit, no payment held. A winner who ghosts costs the seller 24 hours and the only backstop is report/block. This is a policy call, not a code one. |
| **Geocoding provider** | OpenStreetMap Nominatim (free) | Its usage policy forbids production/commercial volume. Fine for a pilot, must be swapped before real traffic. One file: `backend/geocode.ts`. |
| **Object storage provider** | Cloudflare R2 bucket `dibbs-photos` exists; the API was not yet pointed at it as of 2026-10-25 (uploads on container disk) | Photos must be on S3-compatible storage before real users or TestFlight. See `docs/DEPLOY.md` section 4. |
| **Database and container host** | Hosted: Neon (Free plan) and Render `dibbs-api` (Free plan, sleeps when idle) | Paid tiers are the owner's billing call. See `docs/DEPLOY.md`. |
| **Brand name** | **Dibbs** — decided | Settled. Use it as-is for the App Store listing; nothing further is needed from you here. |
| **Bundle identifier** | Still the `com.placeholder.*` value in `app.config.ts` | **Cannot be changed after first submission to Apple.** Pick deliberately. Still open — deciding the brand name did not decide this. |
| **Commission rate** | 10% (`PLATFORM_FEE_PERCENT`) | On a $30 item that is $3.00 to you under direct charges. A single chargeback costs the item value plus Stripe's $15 dispute fee. |

### Things the app now does that the Terms and Privacy text does not yet mention

The rule above still applies: these documents must stay in sync with what the
app actually does. Since they were drafted, the app gained:

- **Auctions** with binding-sounding bid language ("a bid is a commitment to
  buy"). The Terms say nothing about what a bid obliges anyone to do.
- **Payments** via Stripe Connect, including the platform taking a fee and the
  seller becoming merchant of record. The Terms have no payment section, no
  refund/dispute policy, and no statement of who carries chargeback liability.
- **Custom meetup addresses**, meaning users now share home or off-campus
  addresses with each other through the app. The Privacy Policy does not
  describe this, how long it is kept, or who can see it.
- **Push notification tokens**, a new category of device data collected.
- **Object storage**, meaning photos will leave your machine and sit with a
  third-party provider once hosting is set up - a processor the Privacy Policy
  must name.

Each of these belongs in front of the lawyer alongside the original draft.

## Everything else worth knowing

- The age gate in `app/auth/verify.tsx` is a **self-declared checkbox, not
  verification** — the UI says so. It only appears when a user is setting up
  a new account (typing a display name for the first time); existing users
  and the dev "Switch test user" shortcut are unaffected.
- The Terms/Privacy content must stay in sync with `docs/HANDOFF.md` §3
  ("Simulated or unfinished") — if what the app actually does changes (real
  payments added, any further real-integration change such as SMS, etc.), section 3 of the Terms
  and the matching parts of the Privacy Policy need to be updated in the
  same change, not left stale.
- Real email sign-in codes went live on 2026-10-26 (Resend). The draft Terms/Privacy in `constants/legal.ts` still describe sign-in codes as logged to the server console (simulated delivery), so that wording is now stale and needs updating before real users rely on it.
- None of this has been reviewed by a lawyer. Treat every sentence in
  `constants/legal.ts` as a first draft to hand to one, not as something
  ready to bind real students to.

## Added October 24, 2026: posts and archived listings no longer expire
Community posts and unsold listings (the Archive) now stay visible until removed. The draft Terms/Privacy wording in `constants/legal.ts` was updated to say so, but it is still an unreviewed draft: the retention answer (`DATA_RETENTION_PERIOD`) and the deletion promises must cover content that never lapses on its own.

