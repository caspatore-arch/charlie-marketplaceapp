# Outreach kit

Internal, ready-to-paste copy for the Dibbs launch. It fits the plan in
`docs/campaigns/buy-your-stuff-today.md` (main checkout) and
`docs/MESSAGING-LAUNCH.md`. It does not replace them. Nothing here ships in the
app. Anything in [BRACKETS] is something you must fill in.

## What is in it

| File | Use |
|---|---|
| `launch-email.md` | One email to the waitlist when Dibbs opens |
| `welcome-sequence.md` | Three emails for new members (day 0, 2, 6) |
| `flyer-and-qr.md` | Flyer options, QR caption, posting notes |
| `social-posts.md` | 10 captions and 3 short-video ideas |
| `org-and-ra-outreach.md` | Messages to student orgs, RAs and apartment managers |
| `one-pager.md` | A single page to hand to anyone who asks what Dibbs is |

## Rules every piece follows

1. Say what is true today. No invented numbers, quotes or testimonials.
2. "Campus email verified" only means someone confirmed an email address. Never
   call it identity, "verified students" or "real students".
3. Never imply payment protection, escrow, guaranteed safety or guaranteed
   payment. Students pay each other in person. Dibbs offers are paid outside
   the app.
4. Not affiliated with, endorsed by or run by the University of Arizona. Do not
   use the university's name or logos as if we are. Naming the campus to say who
   Dibbs is for is fine.
5. No "within an hour", "today" or "instant" until staffed hours are set
   (see `docs/LEGAL-TODO.md`).
6. No promises about reply times, or what an offer will be.
7. Short sentences. Friendly. No hype.
8. Marketing email needs a postal address and an unsubscribe link first.

## UTM naming

Put these on every link and QR code that points to `https://trydibbs.com`.
Use lowercase, no spaces.

| Channel | utm_source | utm_medium | utm_campaign |
|---|---|---|---|
| Waitlist launch email | `waitlist` | `email` | `launch` |
| Welcome emails | `welcome` | `email` | `welcome-d0`, `welcome-d2`, `welcome-d6` |
| Flyer or poster QR | `flyer` | `print` | `bysd` or `launch` |
| Table tent / tear-off | `tearoff` | `print` | `launch` |
| Instagram bio or story | `instagram` | `social` | `launch` |
| TikTok bio | `tiktok` | `social` | `launch` |
| Student org message | `org-[NAME]` | `referral` | `launch` |
| RA / housing | `housing` | `referral` | `moveout` |
| Apartment managers | `apartments` | `referral` | `moveout` |

Example: `https://trydibbs.com/?utm_source=flyer&utm_medium=print&utm_campaign=bysd`

**The site does not store UTM values yet.** The visit counter keeps only a
daily total per platform. Until that changes, UTM tags show up only in whatever
tool you click through from (for example your link shortener). Use a different
QR code per flyer location if you want to compare them.
