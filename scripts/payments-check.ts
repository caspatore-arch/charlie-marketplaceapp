/**
 * Payments acceptance script — `npx tsx scripts/payments-check.ts`.
 *
 * Proves the Stripe Connect flows end to end **against the deterministic fake
 * gateway**, which is what `simulated` mode uses. Nothing here talks to
 * Stripe: there is no Stripe account and no API key on this project, so no
 * output from this script is evidence about Stripe's real API. What it does
 * prove is that our own logic — ownership checks, the direct-charge shape and
 * fee split, connected-account webhook matching, idempotency, webhook-only
 * terminal states, and the 24h timeout — is correct and will keep working when
 * a real key is swapped in.
 *
 * It runs against its OWN throwaway database directory (wiped on each run), so
 * it never fights `npm run backend` for PGlite's single-writer lock and never
 * touches your demo data. Override with PGLITE_DIR if you want it elsewhere.
 *
 * ⚠️ Everything below the env block is loaded with `await import(...)`, not a
 * static `import`. That is deliberate and load-bearing: static imports are
 * hoisted above these assignments, so `backend/db/client.ts` would read
 * `PGLITE_DIR` before this file had set it and open **backend/data/pg — the
 * demo database** instead. (It did exactly that until 2026-09-15.) Keep the
 * dynamic imports.
 */
import fs from 'node:fs';
import path from 'node:path';

process.env.PAYMENTS_MODE ??= 'simulated';
process.env.DEV_LOGIN = '1';
process.env.PGLITE_DIR ??= 'backend/data/payments-check-pg';
// Fresh every run: the assertions below expect deterministic fake ids.
if (!process.env.DATABASE_URL) {
  fs.rmSync(path.resolve(process.env.PGLITE_DIR), { recursive: true, force: true });
}

import type { eq as EqFn } from 'drizzle-orm';

import type { Db } from '../backend/db/client';
import type * as Schema from '../backend/db/schema';
import type { User } from '../backend/db/schema';
import type { FakeGateway } from '../backend/stripe/fake';
import type { AppRouter } from '../backend/trpc/app-router';

/* Assigned by loadModules() below — see the warning in the file header. */
let eq!: typeof EqFn;
let db!: Db;
let pglite!: { close(): Promise<void> } | null;
let runMigrations!: () => Promise<unknown>;
let campuses!: typeof Schema.campuses;
let listings!: typeof Schema.listings;
let meetupSpots!: typeof Schema.meetupSpots;
let payments!: typeof Schema.payments;
let reservations!: typeof Schema.reservations;
let stripeAccounts!: typeof Schema.stripeAccounts;
let stripeEvents!: typeof Schema.stripeEvents;
let users!: typeof Schema.users;
let env!: typeof import('../backend/env').env;
let fakeGatewayOrNull!: () => FakeGateway | null;
let paymentsMode!: typeof import('../backend/stripe/client').paymentsMode;
let FAKE_WEBHOOK_SIGNATURE!: string;
let STRIPE_FEE_ESTIMATE!: typeof import('../backend/stripe/service').STRIPE_FEE_ESTIMATE;
let estimateStripeFeeCents!: (amountCents: number) => number;
let processSimulatedEvent!: typeof import('../backend/stripe/webhook').processSimulatedEvent;
let appRouter!: AppRouter;

async function loadModules(): Promise<void> {
  ({ eq } = await import('drizzle-orm'));
  ({ db, pglite } = await import('../backend/db/client'));
  ({ runMigrations } = await import('../backend/db/migrate'));
  ({
    campuses,
    listings,
    meetupSpots,
    payments,
    reservations,
    stripeAccounts,
    stripeEvents,
    users,
  } = await import('../backend/db/schema'));
  ({ env } = await import('../backend/env'));
  ({ fakeGatewayOrNull, paymentsMode } = await import('../backend/stripe/client'));
  ({ FAKE_WEBHOOK_SIGNATURE } = await import('../backend/stripe/fake'));
  ({ STRIPE_FEE_ESTIMATE, estimateStripeFeeCents } = await import('../backend/stripe/service'));
  ({ processSimulatedEvent } = await import('../backend/stripe/webhook'));
  ({ appRouter } = await import('../backend/trpc/app-router'));
}

let passes = 0;
let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passes += 1;
    console.log(`PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function expectTrpcError(label: string, code: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, `expected ${code}, but the call succeeded`);
  } catch (err) {
    const actual = (err as { code?: string }).code;
    check(label, actual === code, `got ${actual ?? 'unknown'}: ${(err as Error).message}`);
  }
}

const caller = (user: User) => appRouter.createCaller({ db, user });

/* ------------------------------------------------------------- fixtures */

const CAMPUS_ID = '00000000-0000-4000-8000-0000000000aa';
const SPOT_ID = '00000000-0000-4000-8000-0000000000b1';
const SELLER_ID = '00000000-0000-4000-8000-0000000000c1';
const BUYER_ID = '00000000-0000-4000-8000-0000000000c2';
const STRANGER_ID = '00000000-0000-4000-8000-0000000000c3';

/** $38.00 — the exact figure docs/AUCTIONS.md's fee example is asserted on. */
const SALE_PRICE_CENTS = 3800;

async function seedFixtures(): Promise<{ seller: User; buyer: User; stranger: User }> {
  await db
    .insert(campuses)
    .values({
      id: CAMPUS_ID,
      name: 'University of Arizona',
      slug: 'arizona',
      emailDomains: ['arizona.edu', 'demo.campus.test'],
      timezone: 'America/Phoenix',
      isDemo: true,
    })
    .onConflictDoNothing();

  await db
    .insert(meetupSpots)
    .values({
      id: SPOT_ID,
      campusId: CAMPUS_ID,
      name: 'Student Union Memorial Center',
      description: 'north entrance, by the bike racks',
      lat: 32.2319,
      lng: -110.9501,
      isDemo: true,
    })
    .onConflictDoNothing();

  const people = [
    { id: SELLER_ID, email: 'payments-seller@demo.campus.test', displayName: 'Seller Test' },
    { id: BUYER_ID, email: 'payments-buyer@demo.campus.test', displayName: 'Buyer Test' },
    { id: STRANGER_ID, email: 'payments-stranger@demo.campus.test', displayName: 'Stranger Test' },
  ];
  for (const p of people) {
    await db
      .insert(users)
      .values({ ...p, campusId: CAMPUS_ID, isDemo: true })
      .onConflictDoNothing();
  }

  const rows = await db.select().from(users).where(eq(users.campusId, CAMPUS_ID));
  const byId = new Map(rows.map((u) => [u.id, u]));
  return {
    seller: byId.get(SELLER_ID)!,
    buyer: byId.get(BUYER_ID)!,
    stranger: byId.get(STRANGER_ID)!,
  };
}

/** One settled auction: listing + reservation for the winning bidder. */
async function createSettledAuction(opts: { createdAt?: Date; priceCents?: number } = {}) {
  const createdAt = opts.createdAt ?? new Date();
  const priceCents = opts.priceCents ?? SALE_PRICE_CENTS;

  const [listing] = await db
    .insert(listings)
    .values({
      sellerId: SELLER_ID,
      campusId: CAMPUS_ID,
      title: 'Vintage denim jacket',
      category: 'clothing',
      condition: 'good',
      priceCents,
      saleType: 'auction',
      startPriceCents: 2000,
      status: 'reserved',
      expiresAt: createdAt,
    })
    .returning();

  const [reservation] = await db
    .insert(reservations)
    .values({
      listingId: listing!.id,
      buyerId: BUYER_ID,
      sellerId: SELLER_ID,
      status: 'requested',
      spotId: SPOT_ID,
      startsAt: new Date(createdAt.getTime() + 60 * 60 * 1000),
      proposedById: BUYER_ID,
      priceCents,
      createdAt,
      updatedAt: createdAt,
    })
    .returning();

  return { listing: listing!, reservation: reservation! };
}

/* ----------------------------------------------------------------- main */

async function main(): Promise<void> {
  await loadModules();
  await runMigrations();

  const { mode, reason } = paymentsMode();
  console.log(`\nPayments mode: ${mode} (${reason})\n`);
  check('runs against the fake gateway, not Stripe', mode === 'simulated');

  const { seller, buyer, stranger } = await seedFixtures();

  /* -- 1. seller onboarding creates an account record ------------------ */

  const onboard = await caller(seller).payment.onboardSeller();
  const [accountRow] = await db
    .select()
    .from(stripeAccounts)
    .where(eq(stripeAccounts.userId, seller.id))
    .limit(1);

  check(
    'onboardSeller stores a connected account for the seller',
    accountRow != null && accountRow.stripeAccountId === onboard.stripeAccountId,
    `stripeAccountId=${onboard.stripeAccountId}`,
  );
  check(
    'onboardSeller returns an onboarding link and the simulated banner',
    onboard.onboardingUrl.length > 0 && onboard.banner === 'Simulated — no money moves.',
    onboard.onboardingUrl,
  );

  const statusBefore = await caller(seller).payment.sellerStatus();
  check(
    'a fresh Express account is not payout-ready',
    statusBefore.payoutsEnabled === false && statusBefore.onboarded === false,
  );

  /* -- 2. account.updated webhook flips the payout flags --------------- */

  const accountEvent = await processSimulatedEvent(db, {
    type: 'account.updated',
    accountId: accountRow!.stripeAccountId,
  });
  const statusAfter = await caller(seller).payment.sellerStatus();
  check(
    'account.updated marks the seller payout-ready',
    accountEvent.status === 200 && statusAfter.payoutsEnabled === true,
    JSON.stringify(accountEvent.body),
  );

  /* -- 3. createIntent builds a DIRECT charge with a 10% application fee */

  const { reservation } = await createSettledAuction();
  const intent = await caller(buyer).payment.createIntent({ reservationId: reservation.id });
  const fake = fakeGatewayOrNull()!;
  const createCall = fake.lastIntentCall();

  check(
    'createIntent charges the full $38.00 sale price',
    intent.amountCents === 3800,
    `amountCents=${intent.amountCents}`,
  );
  check(
    'application_fee_amount is exactly 380 cents (10% of $38.00)',
    intent.feeCents === 380 && createCall?.applicationFeeCents === 380,
    `feeCents=${intent.feeCents}, gateway saw ${createCall?.applicationFeeCents}, feePercent=${intent.feePercent}`,
  );
  check(
    'the intent is created ON the seller connected account (direct charge)',
    createCall?.connectedAccountId === accountRow!.stripeAccountId &&
      intent.connectedAccountId === accountRow!.stripeAccountId,
    `stripeAccount=${createCall?.connectedAccountId}`,
  );
  check(
    'no transfer_data.destination and no on_behalf_of are sent',
    createCall?.usedTransferData === false && createCall?.usedOnBehalfOf === false,
  );
  check(
    'the seller keeps 3420 cents before Stripe’s own fee — exact',
    intent.sellerBeforeStripeFeeCents === 3420 &&
      intent.feeCents + intent.sellerBeforeStripeFeeCents === intent.amountCents,
    `sellerBeforeStripeFeeCents=${intent.sellerBeforeStripeFeeCents}`,
  );
  check(
    'the seller’s take-home is reported as an ESTIMATE, net of Stripe’s fee',
    intent.stripeFeeEstimateCents === estimateStripeFeeCents(3800) &&
      intent.sellerNetEstimateCents === 3420 - estimateStripeFeeCents(3800) &&
      intent.sellerNetEstimateCents < intent.sellerBeforeStripeFeeCents &&
      intent.estimateNote === STRIPE_FEE_ESTIMATE.note,
    `stripeFeeEstimate=${intent.stripeFeeEstimateCents}, sellerNetEstimate=${intent.sellerNetEstimateCents}, note="${intent.estimateNote}"`,
  );
  check(
    'the payment row starts at requires_payment, never paid',
    intent.payment.status === 'requires_payment',
  );

  /* -- 4. idempotent per reservation ----------------------------------- */

  const again = await caller(buyer).payment.createIntent({ reservationId: reservation.id });
  const paymentRows = await db
    .select()
    .from(payments)
    .where(eq(payments.reservationId, reservation.id));
  check(
    'createIntent is idempotent — same intent, one payment row, no second charge',
    again.reused === true &&
      again.payment.stripePaymentIntentId === intent.payment.stripePaymentIntentId &&
      paymentRows.length === 1,
    `intent=${again.payment.stripePaymentIntentId}, rows=${paymentRows.length}`,
  );

  /* -- 5. access control ----------------------------------------------- */

  await expectTrpcError('a non-participant cannot create an intent', 'FORBIDDEN', () =>
    caller(stranger).payment.createIntent({ reservationId: reservation.id }),
  );
  await expectTrpcError('a non-participant cannot read the payment', 'FORBIDDEN', () =>
    caller(stranger).payment.byReservation({ reservationId: reservation.id }),
  );
  await expectTrpcError('the seller cannot pay on the buyer’s behalf', 'FORBIDDEN', () =>
    caller(seller).payment.createIntent({ reservationId: reservation.id }),
  );
  await expectTrpcError('a non-seller, non-moderator cannot refund', 'FORBIDDEN', () =>
    caller(buyer).payment.refund({ reservationId: reservation.id, reason: 'changed my mind' }),
  );

  /* -- 6. webhook marks it paid exactly once --------------------------- */

  const intentId = intent.payment.stripePaymentIntentId;
  const EVENT_ID = 'evt_fake_succeeded_fixed_id';

  const first = await processSimulatedEvent(db, {
    type: 'payment_intent.succeeded',
    paymentIntentId: intentId,
    eventId: EVENT_ID,
  });
  const [afterFirst] = await db.select().from(payments).where(eq(payments.id, intent.payment.id));

  const second = await processSimulatedEvent(db, {
    type: 'payment_intent.succeeded',
    paymentIntentId: intentId,
    eventId: EVENT_ID,
  });
  const [afterSecond] = await db.select().from(payments).where(eq(payments.id, intent.payment.id));
  const storedEvents = await db.select().from(stripeEvents).where(eq(stripeEvents.id, EVENT_ID));

  check(
    'payment_intent.succeeded marks the payment paid',
    afterFirst!.status === 'paid' && afterFirst!.paidAt != null,
    `status=${afterFirst!.status}, charge=${afterFirst!.stripeChargeId}`,
  );
  check(
    'the same event id delivered twice is applied exactly once',
    (second.body as { duplicate?: boolean }).duplicate === true &&
      storedEvents.length === 1 &&
      afterSecond!.paidAt?.getTime() === afterFirst!.paidAt?.getTime(),
    `first=${JSON.stringify(first.body)} second=${JSON.stringify(second.body)}`,
  );

  await expectTrpcError('a paid reservation refuses a second intent', 'CONFLICT', () =>
    caller(buyer).payment.createIntent({ reservationId: reservation.id }),
  );

  /* -- 7. refund: requested by the seller, settled by the webhook ------ */

  const refund = await caller(seller).payment.refund({
    reservationId: reservation.id,
    reason: 'item was damaged',
  });
  const [afterRefundCall] = await db.select().from(payments).where(eq(payments.id, intent.payment.id));
  check(
    'payment.refund does NOT set the terminal state itself',
    afterRefundCall!.status === 'paid',
    `status is still ${afterRefundCall!.status} until the webhook lands (refundId=${refund.refundId})`,
  );
  check(
    'the refund is issued ON the seller connected account',
    fake.lastRefundCall()?.connectedAccountId === accountRow!.stripeAccountId &&
      refund.connectedAccountId === accountRow!.stripeAccountId,
    `refund account=${fake.lastRefundCall()?.connectedAccountId}`,
  );

  // A direct charge cannot be refunded from the platform account, and the fake
  // models that: asking any other account must fail rather than silently work.
  let platformRefundRejected = false;
  try {
    await fake.refund({
      paymentIntentId: intentId,
      connectedAccountId: 'acct_fake_not_the_seller',
    });
  } catch {
    platformRefundRejected = true;
  }
  check(
    'refunding a direct charge from another account is refused',
    platformRefundRejected,
  );

  await processSimulatedEvent(db, { type: 'charge.refunded', paymentIntentId: intentId });
  const [afterRefundWebhook] = await db
    .select()
    .from(payments)
    .where(eq(payments.id, intent.payment.id));
  check(
    'charge.refunded sets the payment to refunded',
    afterRefundWebhook!.status === 'refunded',
    `status=${afterRefundWebhook!.status}`,
  );

  /* -- 8. payment_intent.payment_failed -------------------------------- */

  const failCase = await createSettledAuction({ priceCents: 1500 });
  const failIntent = await caller(buyer).payment.createIntent({
    reservationId: failCase.reservation.id,
  });
  await processSimulatedEvent(db, {
    type: 'payment_intent.payment_failed',
    paymentIntentId: failIntent.payment.stripePaymentIntentId,
  });
  const [failed] = await db.select().from(payments).where(eq(payments.id, failIntent.payment.id));
  check(
    'payment_intent.payment_failed marks the payment failed',
    failed!.status === 'failed',
    `status=${failed!.status}`,
  );

  /* -- 9. the 24-hour unpaid timeout ----------------------------------- */

  const stale = await createSettledAuction({
    createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
  });

  // Reading the payment is what triggers the lazy sweep — same shape as applyExpiry.
  const staleView = await caller(buyer).payment.byReservation({
    reservationId: stale.reservation.id,
  });
  const [staleReservation] = await db
    .select()
    .from(reservations)
    .where(eq(reservations.id, stale.reservation.id));
  const [staleListing] = await db
    .select()
    .from(listings)
    .where(eq(listings.id, stale.listing.id));

  check(
    'an unpaid reservation past 24h is cancelled with cancelReason payment_timeout',
    staleReservation!.status === 'cancelled' && staleReservation!.cancelReason === 'payment_timeout',
    `status=${staleReservation!.status}, reason=${staleReservation!.cancelReason}`,
  );
  check(
    'the timed-out listing is released back to the seller',
    staleListing!.status === 'active' || staleListing!.status === 'expired',
    `listing status=${staleListing!.status}`,
  );
  check(
    'the read path reports the timeout and the deadline',
    staleView.payDeadline instanceof Date && staleView.payDeadline.getTime() < Date.now(),
    `payDeadline=${staleView.payDeadline.toISOString()}`,
  );
  await expectTrpcError('a timed-out reservation refuses a new intent', 'CONFLICT', () =>
    caller(buyer).payment.createIntent({ reservationId: stale.reservation.id }),
  );

  /* -- 10. the original simulated quote still works -------------------- */

  const quote = await caller(buyer).payment.quote({ priceCents: 3800 });
  check(
    'payment.quote keeps its exact platform-fee maths and simulated label',
    quote.platformFeeCents === 380 &&
      quote.sellerBeforeStripeFeeCents === 3420 &&
      quote.label === 'Simulated — no money moves',
  );
  check(
    'payment.quote also reports an explicitly-estimated seller net',
    quote.sellerNetEstimateCents === 3420 - estimateStripeFeeCents(3800) &&
      quote.estimateNote === STRIPE_FEE_ESTIMATE.note,
    `sellerNetEstimateCents=${quote.sellerNetEstimateCents}`,
  );

  /* -- 10b. the payout delay is configurable and defaults to 0 --------- */

  const config = await caller(buyer).payment.config();
  check(
    'PAYOUT_DELAY_DAYS defaults to 0 and is reported to the app',
    config.payoutDelayDays === 0 && env.payoutDelayDays === 0,
    `payoutDelayDays=${config.payoutDelayDays}`,
  );
  {
    const previous = process.env.PAYOUT_DELAY_DAYS;
    process.env.PAYOUT_DELAY_DAYS = '7';
    const seven = env.payoutDelayDays;
    let rejectedTooBig = false;
    process.env.PAYOUT_DELAY_DAYS = '31';
    try {
      void env.payoutDelayDays;
    } catch {
      rejectedTooBig = true;
    }
    let rejectedNonInteger = false;
    process.env.PAYOUT_DELAY_DAYS = '2.5';
    try {
      void env.payoutDelayDays;
    } catch {
      rejectedNonInteger = true;
    }
    if (previous === undefined) delete process.env.PAYOUT_DELAY_DAYS;
    else process.env.PAYOUT_DELAY_DAYS = previous;
    check(
      'PAYOUT_DELAY_DAYS accepts 0–30 and rejects anything else',
      seven === 7 && rejectedTooBig && rejectedNonInteger,
      `7 → ${seven}, 31 rejected=${rejectedTooBig}, 2.5 rejected=${rejectedNonInteger}`,
    );
  }
  check(
    'the Express account was created with the configured payout delay',
    (await fake.retrieveAccount(accountRow!.stripeAccountId)).payoutDelayDaysRequested === 0,
  );

  /* -- 11. connected-account webhook matching -------------------------- */

  const { processWebhook } = await import('../backend/stripe/webhook');

  const connCase = await createSettledAuction({ priceCents: 2500 });
  const connIntent = await caller(buyer).payment.createIntent({
    reservationId: connCase.reservation.id,
  });
  const connIntentId = connIntent.payment.stripePaymentIntentId;

  const deliver = (body: Record<string, unknown>) =>
    processWebhook(db, JSON.stringify(body), FAKE_WEBHOOK_SIGNATURE);
  const statusOf = async () =>
    (await db.select().from(payments).where(eq(payments.id, connIntent.payment.id)))[0]!.status;

  const noAccount = await deliver({
    id: 'evt_fake_no_account',
    type: 'payment_intent.succeeded',
    data: { object: { id: connIntentId } },
  });
  check(
    'a payment event with NO connected account is not applied',
    (await statusOf()) === 'requires_payment',
    JSON.stringify(noAccount.body),
  );

  const wrongAccount = await deliver({
    id: 'evt_fake_wrong_account',
    type: 'payment_intent.succeeded',
    account: 'acct_fake_someone_else',
    data: { object: { id: connIntentId } },
  });
  check(
    'a payment event from an UNKNOWN connected account is not applied',
    (await statusOf()) === 'requires_payment',
    JSON.stringify(wrongAccount.body),
  );

  const RIGHT_EVENT_ID = 'evt_fake_connected_ok';
  const rightOnce = await deliver({
    id: RIGHT_EVENT_ID,
    type: 'payment_intent.succeeded',
    account: accountRow!.stripeAccountId,
    data: {
      object: { id: connIntentId, charges: { data: [{ id: 'ch_fake_connected' }] } },
    },
  });
  const afterRight = (
    await db.select().from(payments).where(eq(payments.id, connIntent.payment.id))
  )[0]!;
  const rightTwice = await deliver({
    id: RIGHT_EVENT_ID,
    type: 'payment_intent.succeeded',
    account: accountRow!.stripeAccountId,
    data: {
      object: { id: connIntentId, charges: { data: [{ id: 'ch_fake_connected' }] } },
    },
  });
  const afterRightAgain = (
    await db.select().from(payments).where(eq(payments.id, connIntent.payment.id))
  )[0]!;
  const connEventRows = await db
    .select()
    .from(stripeEvents)
    .where(eq(stripeEvents.id, RIGHT_EVENT_ID));

  check(
    'an event from the RIGHT connected account marks the payment paid',
    rightOnce.status === 200 && afterRight.status === 'paid',
    `status=${afterRight.status}, charge=${afterRight.stripeChargeId}`,
  );
  check(
    'that connected-account event is applied exactly once',
    (rightTwice.body as { duplicate?: boolean }).duplicate === true &&
      connEventRows.length === 1 &&
      afterRightAgain.paidAt?.getTime() === afterRight.paidAt?.getTime(),
    `second=${JSON.stringify(rightTwice.body)}`,
  );

  /* -- 12. a bad webhook signature is rejected ------------------------- */

  const bad = await processWebhook(
    db,
    JSON.stringify({ id: 'evt_forged', type: 'payment_intent.succeeded', data: { object: {} } }),
    'not-the-right-signature',
  );
  const forged = await db.select().from(stripeEvents).where(eq(stripeEvents.id, 'evt_forged'));
  check(
    'a webhook with a bad signature is rejected and never applied',
    bad.status === 400 && forged.length === 0,
    JSON.stringify(bad.body),
  );

  console.log(`\n${passes} passed, ${failures} failed\n`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pglite?.close();
  });
