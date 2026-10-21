/**
 * Bidding was retired in favour of asking prices + structured offers
 * (routes/offer.ts). These two procedures stay ONLY so a stale client that
 * still calls them gets a clear, human message instead of "procedure not
 * found". They never write anything.
 *
 * Existing bid rows are kept (history); listings that were already auctions
 * settle at their original end time via applyExpiry → settleAuction (lib.ts).
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { protectedProcedure, router } from '../trpc';

const RETIRED = 'Bidding has been replaced by offers. Update Dibbs to make an offer or book at the asking price.';

export const bidRouter = router({
  place: protectedProcedure
    .input(z.object({ listingId: z.uuid(), amountCents: z.number().int() }))
    .mutation((): never => {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: RETIRED });
    }),
  buyout: protectedProcedure.input(z.object({ listingId: z.uuid() })).mutation((): never => {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: RETIRED });
  }),
});
