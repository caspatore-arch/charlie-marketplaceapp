/**
 * Whether in-app payment exists at all (server switch PAYMENTS_ENABLED).
 *
 * Off today: no fee breakdowns, no Pay buttons, no Payouts setup. The answer
 * is `false` while loading or on error, so a payment surface never flashes up
 * for a moment and then disappears.
 */
import { trpc } from '@/lib/trpc';

export function usePaymentsEnabled(): boolean {
  const query = trpc.payment.config.useQuery(undefined, { staleTime: 5 * 60_000 });
  return query.data?.paymentsEnabled === true;
}
