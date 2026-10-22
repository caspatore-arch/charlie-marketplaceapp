# Overhaul build rules (for builder agents)

Shared brief for agents building items from `docs/OVERHAUL.md`. The owner has
said to proceed without asking them; the coordinator session decides.

- Read only: `CLAUDE.md`, the top of `docs/OVERHAUL.md` (sections "The pitch" and
  "Owner feature decisions"), your assigned group's section, `constants/theme.ts`,
  and the files you change. Grep `docs/CONTRACT.md` only if behavior is unclear.
- Build every **P1** and **P2** item in your group. Do a **P3** only if it is a
  few lines. Skip anything tagged "needs owner OK".
- Skip items that are already done or moot. Payments are off (no fees, no pay
  step, confirmation page exists), meetups are 15 minutes, and the Saved list
  exists. Copy must never mention fees, Pay or payouts.
- Offers are hidden, not deleted: use `OFFERS_ENABLED` from `constants/features.ts`
  (false). Wrap Offer buttons, offer sheets and the Inbox Offers tab in it.
- Copy follows the pitch: quick with no haggling, sell the same day, free (sellers
  keep 100%), and safe and sure (public campus spots, campus-email-verified students,
  a booked time with a reminder, report and block). Never promise safety or that
  people always show up. Phone verified ≠ campus email verified ≠ identity verified.
- Use theme tokens and the shared components from group 0 (`components/ui`). Don't
  invent font sizes, colors or spacing inline when a token exists.
- Keep server rules intact: auth, ownership, reservation transitions, report/block,
  privacy. Don't change backend behavior unless the item needs it.
- Stay inside your assigned files. Other agents are editing other groups' pages at
  the same time. If you must touch a shared component, make additive changes only
  (new optional props) and say so in your report.
- Verify: `npm run typecheck`, `npx eslint` on the files you touched (no new errors),
  and the test scripts that cover your area (`test:workstreams`, `test:e2e`,
  `test:save`, `test:comments`). If typecheck fails only in another group's files,
  wait a minute and re-run.
- Don't start, stop or seed the dev backend on port 3000. Don't commit, stage,
  stash, reset or check out.
- Report: items done (by page and number), items skipped and why, files changed
  (one line each), test results with counts.

## Shared pieces from group 0 (use these)

- `components/ui`: `TextLink` (href or onPress; underlined accentInk, 48pt target),
  `Button variant="link"`, `RefetchBanner` (`{q.isError && q.data ? <RefetchBanner onRetry={q.refetch} /> : null}`),
  `ErrorState` with optional `title`, `ListingDetailSkeleton`, `ProfileSkeleton`,
  `HeaderCloseButton` (modal headerLeft).
- Tokens: `colors.tint` (neutral decorative card), `radius.xl`, `space.section`,
  Text variants `hero`, `displaySm`, `lead`, `bodySm`, `small`.
- `constants/features.ts`: `OFFERS_ENABLED = false`.
- Headers: pushed screens now show their own title and a native back button; set a
  good `title` via `<Stack.Screen options={{ title }} />` in your screen if missing.
