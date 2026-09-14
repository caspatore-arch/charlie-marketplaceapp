/**
 * Simulated fee maths only. There is no payment table, no payment record and
 * no payment provider anywhere in this codebase — the quote exists so the UI
 * can show an honest, clearly-labelled breakdown.
 */
import { z } from 'zod';

import { env } from '../../env';
import { publicProcedure, router } from '../trpc';

export const paymentRouter = router({
  quote: publicProcedure
    .input(z.object({ priceCents: z.number().int().min(0) }))
    .query(({ input }) => {
      const feePercent = env.platformFeePercent;
      const platformFeeCents = Math.round((input.priceCents * feePercent) / 100);
      return {
        priceCents: input.priceCents,
        platformFeeCents,
        sellerNetCents: input.priceCents - platformFeeCents,
        feePercent,
        simulated: true as const,
        label: 'Simulated — no money moves' as const,
      };
    }),
});
