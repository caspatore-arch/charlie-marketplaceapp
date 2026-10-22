# Dibbs monthly running-cost planning model

Prepared October 21, 2026. These are planning budgets, not provider quotes or demonstrated capacity. Claude was requested but could not authenticate (expired OAuth session); this model was calculated locally with Python instead.

## Assumptions

Use **monthly active users (MAU)**, not total registrations or simultaneous users.
Per active user/month: 2 email sign-ins, 0.5 listings, 0.25 bookings; each booking sends 2 confirmation emails. Assume 50% transactional SMS opt-in, one seller text per listing and four participant texts per booking (two confirmations and two reminders). Base case uses email sign-in; no phone codes.

- Texts = MAU × (0.5 + 4 × 0.25) × 50% = 0.75 × MAU.
- Budget 3 segments/text because item names, links, and Unicode can split messages: segments = 2.25 × MAU. Actual segmentation varies; measure production bodies before revising this assumption.
- Twilio US long-code base rate checked October 21: $0.0083/segment. Add an **assumed** $0.004 carrier allowance: $0.0123/segment. Source: [Twilio US SMS pricing](https://www.twilio.com/en-us/sms/pricing/us). Carrier fees vary; this allowance is not a quoted universal fee.
- Emails = MAU × (2 + 2 × 0.25) = 2.5 × MAU. Use a conservative planning allowance of $20 for each started block of 50,000 emails. This is **not a verified current Resend plan**; check [Resend pricing](https://resend.com/pricing) before purchasing. Free plans may lower pilot costs but daily caps matter.
- Infrastructure budgets include frontend hosting, backend, database, photo storage and egress: $25/$75/$250/$1,000 at the four scales below. These are assumptions, not selected hosts or evidence the app can serve those populations.
- Add $15/month as a placeholder for number rental and recurring registration fees; exact sender type/campaign fees require account setup.

## Monthly base case (USD)

| MAU | Texts | Segments | Emails | SMS | Email budget | Infrastructure | Number/registration | Total | Per MAU |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 75 | 225 | 250 | $2.77 | $20 | $25 | $15 | **$62.77** | $0.628 |
| 1,000 | 750 | 2,250 | 2,500 | $27.68 | $20 | $75 | $15 | **$137.68** | $0.138 |
| 10,000 | 7,500 | 22,500 | 25,000 | $276.75 | $20 | $250 | $15 | **$561.75** | $0.056 |
| 50,000 | 37,500 | 112,500 | 125,000 | $1,383.75 | $60 | $1,000 | $15 | **$2,458.75** | $0.049 |

## Sensitivity

Doubling all posting, booking and sign-in activity doubles message volumes, but leaves infrastructure and number allowances unchanged **only to isolate messaging cost**. Real hosting costs may also rise.

| MAU | Base monthly | 2× activity | Extra for 2 one-segment phone codes per MAU |
|---:|---:|---:|---:|
| 100 | $62.77 | $65.53 | +$2.46 |
| 1,000 | $137.68 | $165.35 | +$24.60 |
| 10,000 | $561.75 | $838.50 | +$246.00 |
| 50,000 | $2,458.75 | $3,882.50 | +$1,230.00 |

At 100% SMS opt-in, transactional SMS spend doubles. At one segment per text, it is one third of the base estimate. Phone-code sensitivity is additive; if it replaces email logins, subtract the corresponding email volume when recomputing the email budget.

Excluded: one-time carrier registration, taxes, inbound SMS, retries/resends, reschedules, support/moderation labor, legal work, paid marketing, domain renewal and payment processing. Payments are currently simulated. Bookings under 30 minutes away do not get reminders, so this model conservatively assumes every booking gets them.

Before scaling, measure daily active users, peak concurrent requests, photos/listing, average photo bytes, image downloads, database size, query latency and actual SMS segment counts. A headcount alone cannot establish capacity or a hosting bill.
