/**
 * One function per product event that should push a notification. Each
 * builds the title/body/deep-link and calls `notifyUsers`. Keeping these
 * together (rather than inlining copy at each call site in the route files)
 * keeps the wording consistent and in one place to audit against
 * docs/DESIGN.md's copy rules: no fabricated urgency, no "guaranteed" /
 * "protected" / "paid", nothing that overstates what happened.
 *
 * Every recipient list here is the caller's responsibility to build
 * correctly (never the actor, never someone who blocked/was blocked) — these
 * helpers do not re-derive that; `notifyUsers` only applies the per-category
 * preference filter.
 */
import type { Db } from '../db/client';
import { notifyUsers, type NotifyDeps, type NotifyResult } from './send';

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/* ------------------------------------------------------------- messages */

export async function notifyNewMessage(
  db: Db,
  args: {
    recipientId: string;
    senderId: string;
    senderName: string;
    conversationId: string;
    listingTitle: string;
    body: string;
  },
  deps?: NotifyDeps,
): Promise<NotifyResult> {
  return notifyUsers(
    db,
    {
      userIds: [args.recipientId],
      category: 'messages',
      title: `New message from ${args.senderName}`,
      body: truncate(args.body, 120),
      data: { path: `/conversation/${args.conversationId}`, type: 'message', conversationId: args.conversationId },
    },
    deps,
  );
}

/* ------------------------------------------------------------- meetups */

export type MeetupEventKind = 'requested' | 'booked' | 'accepted' | 'declined' | 'countered' | 'cancelled';

const MEETUP_COPY: Record<MeetupEventKind, (listingTitle: string, otherName: string) => { title: string; body: string }> = {
  requested: (listingTitle, otherName) => ({
    title: 'Meetup requested',
    body: `${otherName} wants to meet up for "${listingTitle}".`,
  }),
  booked: (listingTitle, otherName) => ({
    title: 'New booking',
    body: `${otherName} booked a meetup for "${listingTitle}". Check the time and place in the app.`,
  }),
  accepted: (listingTitle) => ({
    title: 'Meetup accepted',
    body: `Your meetup for "${listingTitle}" is set. Check the details in the app.`,
  }),
  declined: (listingTitle) => ({
    title: 'Meetup declined',
    body: `Your request for "${listingTitle}" was declined.`,
  }),
  countered: (listingTitle, otherName) => ({
    title: 'New time proposed',
    body: `${otherName} proposed a different time for "${listingTitle}".`,
  }),
  cancelled: (listingTitle) => ({
    title: 'Meetup cancelled',
    body: `Your meetup for "${listingTitle}" was cancelled.`,
  }),
};

export async function notifyMeetupEvent(
  db: Db,
  args: {
    recipientId: string;
    otherName: string;
    reservationId: string;
    listingTitle: string;
    kind: MeetupEventKind;
  },
  deps?: NotifyDeps,
): Promise<NotifyResult> {
  const copy = MEETUP_COPY[args.kind](args.listingTitle, args.otherName);
  return notifyUsers(
    db,
    {
      userIds: [args.recipientId],
      category: 'meetups',
      title: copy.title,
      body: copy.body,
      data: { path: `/reservation/${args.reservationId}`, type: 'meetup', reservationId: args.reservationId, kind: args.kind },
    },
    deps,
  );
}

/* ------------------------------------------------------------- auctions */

/** Outbid — goes to the previous top bidder only, never anyone else. */
export async function notifyOutbid(
  db: Db,
  args: { previousTopBidderId: string; listingId: string; listingTitle: string; currentPriceCents: number },
  deps?: NotifyDeps,
): Promise<NotifyResult> {
  return notifyUsers(
    db,
    {
      userIds: [args.previousTopBidderId],
      category: 'auctions',
      title: "You've been outbid",
      body: `Someone bid higher on "${args.listingTitle}" — current bid ${money(args.currentPriceCents)}.`,
      data: { path: `/listing/${args.listingId}`, type: 'outbid', listingId: args.listingId },
    },
    deps,
  );
}

export async function notifyAuctionWon(
  db: Db,
  args: { winnerId: string; listingId: string; listingTitle: string; priceCents: number; reservationId: string | null },
  deps?: NotifyDeps,
): Promise<NotifyResult> {
  const path = args.reservationId ? `/reservation/${args.reservationId}` : `/listing/${args.listingId}`;
  return notifyUsers(
    db,
    {
      userIds: [args.winnerId],
      category: 'auctions',
      title: 'You won the auction',
      body: `You won "${args.listingTitle}" for ${money(args.priceCents)}. Arrange the handoff in the app.`,
      data: {
        path,
        type: 'auction_won',
        listingId: args.listingId,
        reservationId: args.reservationId,
      },
    },
    deps,
  );
}

export async function notifyAuctionEndedNoBids(
  db: Db,
  args: { sellerId: string; listingId: string; listingTitle: string },
  deps?: NotifyDeps,
): Promise<NotifyResult> {
  return notifyUsers(
    db,
    {
      userIds: [args.sellerId],
      category: 'auctions',
      title: 'Auction ended',
      body: `Your auction for "${args.listingTitle}" ended with no bids.`,
      data: { path: `/listing/${args.listingId}`, type: 'auction_ended_no_bids', listingId: args.listingId },
    },
    deps,
  );
}

/* --------------------------------------------------------------- offers */

export type OfferEventKind = 'received' | 'accepted' | 'declined';

export async function notifyOfferEvent(
  db: Db,
  args: { recipientId: string; listingId: string; listingTitle: string; amountCents: number; kind: OfferEventKind },
  deps?: NotifyDeps,
): Promise<NotifyResult> {
  const amount = money(args.amountCents);
  const copy =
    args.kind === 'received'
      ? { title: 'New offer', body: `Someone offered ${amount} for "${args.listingTitle}".` }
      : args.kind === 'accepted'
        ? { title: 'Offer accepted', body: `Your ${amount} offer for "${args.listingTitle}" was accepted. Pick a meetup time within the hour.` }
        : { title: 'Offer declined', body: `Your ${amount} offer for "${args.listingTitle}" was declined.` };
  return notifyUsers(
    db,
    {
      userIds: [args.recipientId],
      category: 'offers',
      ...copy,
      data: { path: `/listing/${args.listingId}`, type: `offer_${args.kind}`, listingId: args.listingId },
    },
    deps,
  );
}
