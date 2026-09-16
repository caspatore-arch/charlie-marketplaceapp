import { router } from './trpc';
import { authRouter } from './routes/auth';
import { bidRouter } from './routes/bid';
import { campusRouter } from './routes/campus';
import { conversationRouter } from './routes/conversation';
import { listingRouter } from './routes/listing';
import { moderationRouter } from './routes/moderation';
import { notificationRouter } from './routes/notification';
import { paymentRouter } from './routes/payment';
import { reservationRouter } from './routes/reservation';
import { userRouter } from './routes/user';

export const appRouter = router({
  auth: authRouter,
  campus: campusRouter,
  listing: listingRouter,
  bid: bidRouter,
  conversation: conversationRouter,
  reservation: reservationRouter,
  user: userRouter,
  payment: paymentRouter,
  moderation: moderationRouter,
  notification: notificationRouter,
});

export type AppRouter = typeof appRouter;
