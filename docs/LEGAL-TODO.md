# Legal & eligibility to-do (read this before any real launch)

**This is not legal advice.** This checklist and the placeholder Terms/Privacy
text in `app/legal/content.ts` were written by a non-lawyer founder (with AI
assistance) for a local prototype. Before onboarding real students, a lawyer
needs to review the final Terms of Service and Privacy Policy, and confirm the
age-gating and data-handling approach.

## Every `[FOUNDER TO CONFIRM]` marker, in one place

These live in `app/legal/content.ts` and are rendered verbatim inside the
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

## Everything else worth knowing

- The age gate in `app/auth/verify.tsx` is a **self-declared checkbox, not
  verification** — the UI says so. It only appears when a user is setting up
  a new account (typing a display name for the first time); existing users
  and the dev "Switch test user" shortcut are unaffected.
- The Terms/Privacy content must stay in sync with `docs/HANDOFF.md` §3
  ("Simulated or unfinished") — if what the app actually does changes (real
  payments added, real email sending added, etc.), section 3 of the Terms
  and the matching parts of the Privacy Policy need to be updated in the
  same change, not left stale.
- None of this has been reviewed by a lawyer. Treat every sentence in
  `app/legal/content.ts` as a first draft to hand to one, not as something
  ready to bind real students to.
