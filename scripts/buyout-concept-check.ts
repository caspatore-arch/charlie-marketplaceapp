/** Plain assertions for the isolated buyout concept. Run: npx tsx scripts/buyout-concept-check.ts */
import assert from 'node:assert/strict';
import {
  buyoutOfferCents, DEFAULT_BUYOUT_CONFIG, evaluateEligibility, sellerAccept, sellerDecline,
  transition, canTransition, type BuyoutConfig,
} from '../prototypes/buyout/logic';
import { makeFixtures } from '../prototypes/buyout/fixtures';

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log(`ok - ${name}`); };

ok('25% math', () => {
  assert.equal(buyoutOfferCents(10000), 2500);
  assert.notEqual(buyoutOfferCents(10000), 7500);
  assert.equal(buyoutOfferCents(4000), 1000);
});
ok('odd-cent rounding (Math.round)', () => {
  assert.equal(buyoutOfferCents(1001), 250); // 250.25
  assert.equal(buyoutOfferCents(1002), 251); // 250.5 rounds up
  assert.equal(buyoutOfferCents(1003), 251); // 250.75
  assert.equal(buyoutOfferCents(1), 0);
});
ok('default config disabled', () => {
  assert.equal(DEFAULT_BUYOUT_CONFIG.enabled, false);
});

const now = Date.UTC(2026, 0, 1, 12, 0, 0);
const f = Object.fromEntries(makeFixtures(now).map((x) => [x.id, x]));
const cfg: BuyoutConfig = { ...DEFAULT_BUYOUT_CONFIG };

ok('eligible $100 and $40 listings', () => {
  const a = evaluateEligibility(f['FAKE-1'], cfg, now);
  assert.equal(a.eligible, true); assert.equal(a.offerCents, 2500);
  const b = evaluateEligibility(f['FAKE-2'], cfg, now, 2500);
  assert.equal(b.eligible, true); assert.equal(b.offerCents, 1000);
});
ok('reserved is ineligible', () => {
  assert.ok(evaluateEligibility(f['FAKE-3'], cfg, now).reasons.includes('already_reserved_sold_or_booked'));
});
ok('outside window is ineligible', () => {
  assert.ok(evaluateEligibility(f['FAKE-4'], cfg, now).reasons.includes('outside_trigger_window'));
});
ok('below minimum and category', () => {
  const r = evaluateEligibility(f['FAKE-5'], cfg, now).reasons;
  assert.ok(r.includes('below_minimum')); assert.ok(r.includes('category_not_eligible'));
});
ok('live accepted offer hold blocks', () => {
  assert.ok(evaluateEligibility(f['FAKE-6'], cfg, now).reasons.includes('live_accepted_offer_hold'));
});
ok('over budget', () => {
  assert.ok(evaluateEligibility(f['FAKE-1'], cfg, now, cfg.budgetCapCents).reasons.includes('over_budget'));
});
ok('expired listing not active', () => {
  assert.ok(evaluateEligibility({ ...f['FAKE-1'], expiresAt: now - 1 }, cfg, now).reasons.includes('not_active'));
});
ok('state machine', () => {
  assert.equal(sellerAccept('proposed'), 'manual_review');
  assert.equal(sellerDecline('proposed'), 'seller_declined');
  assert.equal(sellerAccept('seller_declined'), 'seller_declined');
  assert.equal(transition('proposed', 'expired'), 'expired');
  assert.equal(canTransition('proposed', 'manual_review'), false);
  assert.equal(canTransition('manual_review', 'seller_accepted'), false);
});
console.log(`\n${n} checks passed`);
