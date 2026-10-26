# Messaging activation handoff

Email is live (Resend); Twilio SMS is not set up and remains simulated. No end-to-end booking-email check is recorded in the docs; do step 4 below.
Existing owner rules require approval before purchasing a number, changing
billing, creating credentials or changing DNS. Never paste secrets into chat or git.

## Email

**Status 2026-10-26:** Resend is set up for `trydibbs.com` with `EMAIL_MODE=live`
on the Render API, and `/api/health` reports email live (free plan, 100/day and
3,000/month). Steps 1-2 below are done; step 3 is how to confirm it; step 4
(a real booking email test with two approved accounts) is the part still worth
doing. Hosting details are in `docs/DEPLOY.md`.

1. Deploy backend with migration `0014_booking_emails`; back up persistent data
   and review the additive migration before the production rollout.
2. Verify the sending domain in Resend and store the owner-approved sending key
   in the backend host secret manager. Set `EMAIL_MODE=live`, `RESEND_API_KEY`,
   `EMAIL_FROM=Dibbs <codes@trydibbs.com>`, and `EXPO_PUBLIC_WEB_BASE_URL=https://trydibbs.com`.
3. The long-running backend process starts the confirmation worker every 30s.
   Static hosting alone cannot run it. Confirm `/api/health` says email is live.
4. With two owner-approved test accounts, book a future meetup and confirm each
   receives an email showing campus time, spot, agreed price and reservation link.
   Inspect provider delivery status and both inboxes. Cancel before dispatch and
   confirm the queued confirmation is skipped. Email does not replace checking
   current meetup state in the app.

## Twilio

1. Sign in to the intended Twilio account. Choose an approved US sender and
   complete the appropriate registration (A2P 10DLC or toll-free verification).
   Account choice, purchases and fees remain owner actions/approval boundaries.
2. Configure a Messaging Service with Advanced Opt-Out. Set its incoming-message
   integration to POST to the actual backend HTTPS URL ending `/api/sms/inbound`.
   Set **exactly that full URL**, including any query, in `TWILIO_INBOUND_WEBHOOK_URL`.
   Do not point at the static web frontend. Do not use redirects on this callback.
3. Store `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` as backend secrets. Set
   `TWILIO_FROM` to the Messaging Service SID, `SMS_MODE=live`, `SMS_LIVE_ACK=1`,
   and `SMS_APP_LINK_BASE=https://trydibbs.com`. Leave dispatcher interval nonzero.
4. Verify health reports live SMS. With consenting test recipients, verify phone
   code delivery, listing-posted text, both booking confirmations and reminders.
   Check Twilio delivery logs; API acceptance alone is not delivery proof.
5. Reply STOP. Confirm Twilio blocks further sends, app `smsOptIn` is false and
   scheduled texts are cancelled. A forged callback must receive 403. To resume,
   unblock at the carrier using START, then opt back in through Dibbs settings.
6. Keep automated tests simulated. No live test messages were sent in this change.

References: [Twilio webhook security](https://www.twilio.com/docs/usage/security),
[Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out).
