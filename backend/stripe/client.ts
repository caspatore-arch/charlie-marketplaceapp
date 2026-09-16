/**
 * Resolves which payments mode the server is actually in, and hands out the
 * single gateway instance that matches it.
 *
 * The rule from docs/AUCTIONS.md §3, and it is not negotiable:
 * **if `STRIPE_SECRET_KEY` is absent the mode is `simulated`**, whatever
 * `PAYMENTS_MODE` says. `live` additionally requires `STRIPE_LIVE_ACK=1`, so
 * real money cannot be reached by setting one variable by accident.
 *
 * Every UI label is derived from `GET /api/health` → `payments.mode`, so the
 * app can never claim to be taking payments when it is not.
 */
import { env } from '../env';
import { FakeGateway } from './fake';
import type { PaymentGateway, PaymentsMode } from './gateway';
import { StripeGateway } from './real';

export interface ResolvedPaymentsMode {
  mode: PaymentsMode;
  /** Why the mode is what it is — surfaced on /api/health for a confused operator. */
  reason: string;
  /** What PAYMENTS_MODE asked for, before the safety rules were applied. */
  requested: string;
}

export function resolvePaymentsMode(): ResolvedPaymentsMode {
  const requested = env.paymentsModeRaw;

  if (!env.stripeSecretKey) {
    return {
      mode: 'simulated',
      requested,
      reason:
        requested === 'simulated'
          ? 'PAYMENTS_MODE=simulated'
          : `PAYMENTS_MODE=${requested} but STRIPE_SECRET_KEY is not set — forced to simulated.`,
    };
  }

  if (requested === 'live') {
    if (!env.stripeLiveAck) {
      return {
        mode: 'simulated',
        requested,
        reason: 'PAYMENTS_MODE=live requires STRIPE_LIVE_ACK=1 — forced to simulated.',
      };
    }
    return { mode: 'live', requested, reason: 'PAYMENTS_MODE=live with STRIPE_LIVE_ACK=1.' };
  }

  if (requested === 'test') {
    return { mode: 'test', requested, reason: 'PAYMENTS_MODE=test with a Stripe secret key.' };
  }

  return {
    mode: 'simulated',
    requested,
    reason: `PAYMENTS_MODE=${requested} is not one of simulated|test|live — treated as simulated.`,
  };
}

let cachedMode: ResolvedPaymentsMode | null = null;
let cachedGateway: PaymentGateway | null = null;

/** Memoized so the mode cannot drift between two reads inside one request. */
export function paymentsMode(): ResolvedPaymentsMode {
  cachedMode ??= resolvePaymentsMode();
  return cachedMode;
}

export function isSimulated(): boolean {
  return paymentsMode().mode === 'simulated';
}

export function gateway(): PaymentGateway {
  if (cachedGateway) return cachedGateway;
  const { mode } = paymentsMode();
  cachedGateway =
    mode === 'simulated' ? new FakeGateway() : new StripeGateway(env.stripeSecretKey!);
  return cachedGateway;
}

/** The fake, when that is what is in use — the local simulate hook needs its helpers. */
export function fakeGatewayOrNull(): FakeGateway | null {
  const g = gateway();
  return g instanceof FakeGateway ? g : null;
}

/** The banner every payment surface shows while no real money can move. */
export const SIMULATED_BANNER = 'Simulated — no money moves.' as const;

/** Test-only: forget the memoized mode/gateway after changing process.env. */
export function resetPaymentsCacheForTests(): void {
  cachedMode = null;
  cachedGateway = null;
}
