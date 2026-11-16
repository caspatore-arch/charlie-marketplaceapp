# Legal and launch to-do (what only the owner or a lawyer can settle)

**Not legal advice.** The Terms, Privacy Policy and Community rules in
`constants/legal.ts` were written by a non-lawyer with AI help. They are marked
as a draft in the app and must stay marked until a lawyer has reviewed them.
Last copy revision: November 16, 2026 (Dibbs offers, community rules, privacy
checked against the code).

Decided and no longer open: operator Charles Aspatore, contact
hello@trydibbs.com, Arizona law, minimum age 18, no analytics, 30-day deletion
after account closure (`backend/retention.ts`). On 2026-11-06 the owner decided
Dibbs does not need texts or in-app payments, so the old auction, Stripe
go-live and SMS items are gone from this list.

## Before real marketing or volume

| # | Open item | Why it matters |
|---|---|---|
| 1 | **Lawyer review** of the Terms, Privacy Policy and Community rules | The liability cap, "as is" wording, the Dibbs offer terms and the privacy claims are founder wording. A lawyer should also say whether the age gate and data handling are enough. |
| 2 | **Dealer rules for buying used goods.** Does buying secondhand items directly need a secondhand-dealer, pawn or similar license or record-keeping in Arizona or Tucson? Also sales tax on resale and any payout or income reporting. | "Get a Dibbs offer" makes Dibbs a buyer and later a reseller. Some places require licenses, holds on goods and records of who sold what. **Answer this before buying at volume.** |
| 3 | **Postal mailing address** for marketing email footers | US email-marketing law (CAN-SPAM) requires a valid postal address in commercial email. Nothing in the app shows one. Needed before the launch email. |
| 4 | **Unsubscribe mechanism** for the waitlist | Marketing email must let people opt out and honor it. Build or choose it before any email goes to the waitlist. The waitlist form exists in the main checkout but is not merged here. |
| 5 | **Privacy Policy paragraph for the waitlist** | Once waitlist emails are collected, the policy must say what is stored and why. Not written yet because the feature is not merged. |
| 6 | **Team hours** | No "offer within an hour" or "today" claim may ship until staffed hours are set. The app promises no reply time. |
| 7 | **Report response-time commitment** | Apple's review guidelines for apps with user content expect reports to be acted on in a timely way. The copy promises no time. Decide one you can keep and then say it. |
| 8 | **Record Terms acceptance and age confirmation on the server** | Today both are only a client checkbox (`components/auth/EmailAuthFlow.tsx`). If a dispute arises, there is no server record of who agreed to which version and when. |
| 9 | **Retention for Dibbs offer requests** | `backend/retention.ts` does not delete them, and the Privacy Policy says they are kept until deleted on request. Decide a period (and whether it covers photos and video), then add it to the job and the policy together. |
| 10 | **Estimate validity** | The 48-hour lapse is a placeholder in `backend/dibbs/rules.ts` and the Terms now state 48 hours. If you change it, change both. |
| 11 | **DMCA designated agent** | The Terms accept copyright complaints by email and say no agent is registered. Registering one gives users of the service a safe harbor in US law; ask the lawyer whether it is worth it for a student marketplace. |
| 12 | **Form a company?** | The operator is currently an individual, so the liability limit is the only protection. Ask whether to incorporate before real volume or before buying goods. |
| 13 | **App Store bundle identifier** | Still the `com.placeholder.*` value in `app.config.ts`. It cannot change after the first submission. |

## Also needed for the App Store

1. A public web URL for the Privacy Policy (today it only exists inside the app).
2. An accurate App Privacy questionnaire. Current answers: no analytics or ads
   SDK; push tokens (Expo); photos and video; photos sent to Anthropic only if
   the autofill feature is switched on; address text sent to OpenStreetMap
   Nominatim.
3. An age rating that fits user content, chat and in-person meetups.
4. A support contact (hello@trydibbs.com).

## Known gaps in the copy

- Geocoding uses the free OpenStreetMap Nominatim service, whose usage policy
  does not allow production-volume use. Swap it before real traffic
  (`backend/geocode.ts`).
- `app/why-dibbs.tsx` still says "Free, and you keep 100%" and "no
  haggling". Those are true for student-to-student listings but need a line
  that covers Dibbs offers.
- Keep the Terms and Privacy in step with the code in the same change
  whenever a feature changes who gets data or money.
