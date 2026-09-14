import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { campuses, meetupSpots } from '../../db/schema';
import { publicProcedure, router } from '../trpc';

export const campusRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(campuses).orderBy(asc(campuses.name));
  }),

  spots: publicProcedure
    .input(z.object({ campusId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(meetupSpots)
        .where(and(eq(meetupSpots.campusId, input.campusId), eq(meetupSpots.isActive, true)))
        .orderBy(asc(meetupSpots.name));
    }),
});
