/**
 * Notifications for Dibbs offer requests.
 *
 * Email goes through a durable queue (dibbs_offer_notifications), written in
 * the same transaction as the change it describes, so a saved request always
 * has its alert row even if the provider is down. Same worker pattern as
 * booking emails: SKIP LOCKED claims, stale-claim recovery, 1/2/4/8 minute
 * backoff, fifth failure terminal, a stable Resend Idempotency-Key per row,
 * and a re-check of current state before sending (stale rows are skipped).
 *
 * Team alerts go to DIBBS_OFFERS_EMAIL (server-side only). Their link opens
 * the staff review page, which needs a signed-in staff account; the link
 * itself approves nothing. Seller emails use the address on the account,
 * which is only ever stored after a code proved the inbox.
 *
 * Push notifications to the seller are best-effort, like every other push.
 */
import { and, asc, eq, inArray, lt, lte } from 'drizzle-orm';

import { setInterval } from '../lib/timers';
import type { Db } from '../db/client';
import {
  campuses,
  dibbsOfferMedia,
  dibbsOfferNotifications,
  dibbsOfferRequests,
  listings,
  meetupSpots,
  users,
  type DibbsOfferRequest,
} from '../db/schema';
import { emailProvider, type EmailMessage } from '../email/provider';
import { env } from '../env';
import { notifyUsers } from '../notifications/send';
import { getPrivate } from './media';
import { estimateLabel, moneyLabel } from './rules';

export type TeamKind = 'new_request' | 'info_provided' | 'meetup_proposed';
export type SellerEmailKind = 'estimate' | 'needs_info' | 'declined' | 'meetup_proposed' | 'meetup_confirmed';

/** Insert inside the transaction that made the change. Duplicate keys are ignored. */
export async function enqueueTeamEmail(tx: Db, request: Pick<DibbsOfferRequest, 'id' | 'version'>, kind: TeamKind) {
  await tx
    .insert(dibbsOfferNotifications)
    .values({
      requestId: request.id,
      audience: 'team',
      kind,
      refVersion: request.version,
      dedupeKey: `team:${kind}:${request.id}:${kind === 'new_request' ? 0 : request.version}`,
    })
    .onConflictDoNothing();
}

export async function enqueueSellerEmail(
  tx: Db,
  request: Pick<DibbsOfferRequest, 'id' | 'version' | 'estimateVersion'>,
  kind: SellerEmailKind,
) {
  const ref = kind === 'estimate' ? request.estimateVersion : request.version;
  await tx
    .insert(dibbsOfferNotifications)
    .values({ requestId: request.id, audience: 'seller', kind, refVersion: ref, dedupeKey: `seller:${kind}:${request.id}:${ref}` })
    .onConflictDoNothing();
}

/* --------------------------------------------------------------- push */

export type SellerPushKind =
  | 'estimate'
  | 'needs_info'
  | 'declined'
  | 'meetup_proposed'
  | 'meetup_confirmed'
  | 'meetup_cancelled'
  | 'final_offer'
  | 'closed';

const PUSH_COPY: Record<SellerPushKind, (item: string) => { title: string; body: string }> = {
  estimate: (item) => ({ title: 'Dibbs sent an estimate', body: `See the estimate for "${item}". It's subject to inspection.` }),
  needs_info: (item) => ({ title: 'Dibbs has a question', body: `The Dibbs team needs a bit more about "${item}".` }),
  declined: (item) => ({ title: 'Update on your Dibbs request', body: `Dibbs can't make an offer on "${item}" this time.` }),
  meetup_proposed: (item) => ({ title: 'Dibbs proposed a meetup', body: `Check the time and place for "${item}".` }),
  meetup_confirmed: (item) => ({ title: 'Meetup with Dibbs confirmed', body: `Your campus meetup for "${item}" is set.` }),
  meetup_cancelled: (item) => ({ title: 'Meetup with Dibbs cancelled', body: `The meetup for "${item}" was cancelled.` }),
  final_offer: (item) => ({ title: 'Dibbs made a final offer', body: `Accept or decline the final offer for "${item}".` }),
  closed: (item) => ({ title: 'Update on your Dibbs request', body: `Your request for "${item}" was closed.` }),
};

export async function pushSeller(db: Db, request: Pick<DibbsOfferRequest, 'id' | 'sellerId' | 'itemName'>, kind: SellerPushKind) {
  const copy = PUSH_COPY[kind](request.itemName.slice(0, 60));
  try {
    await notifyUsers(db, {
      userIds: [request.sellerId],
      category: 'offers',
      title: copy.title,
      body: copy.body,
      data: { path: `/dibbs-offer/${request.id}`, type: 'dibbs_offer', requestId: request.id },
    });
  } catch {
    console.error('[dibbs] push failed', request.id);
  }
}

/* --------------------------------------------------------------- email */

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const CONDITION_LABEL: Record<string, string> = { new: 'New', like_new: 'Like new', good: 'Good', fair: 'Fair' };
const MAX_INLINE_BYTES = 5 * 1024 * 1024;

async function teamEmail(db: Db, request: DibbsOfferRequest, kind: TeamKind, to: string): Promise<EmailMessage> {
  const [campus] = await db.select().from(campuses).where(eq(campuses.id, request.campusId));
  const [seller] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, request.sellerId));
  const [listing] = request.listingId
    ? await db.select({ id: listings.id, title: listings.title, priceCents: listings.priceCents }).from(listings).where(eq(listings.id, request.listingId))
    : [];
  const media = await db
    .select()
    .from(dibbsOfferMedia)
    .where(eq(dibbsOfferMedia.requestId, request.id))
    .orderBy(asc(dibbsOfferMedia.sortOrder));
  const photos = media.filter((m) => m.kind === 'image').length;
  const videos = media.filter((m) => m.kind === 'video').length;
  const tz = campus?.timezone ?? 'America/Phoenix';
  const submitted = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(request.createdAt);
  const link = `${env.webBaseUrl}/staff/dibbs-offers/${request.id}`;

  const heading =
    kind === 'new_request'
      ? 'New Dibbs offer request'
      : kind === 'info_provided'
        ? 'Seller answered your question'
        : 'Seller proposed a meetup time';
  const rows: [string, string][] = [
    ['Item', request.itemName],
    ...(request.condition ? [['Condition', CONDITION_LABEL[request.condition] ?? request.condition] as [string, string]] : []),
    ...(request.specs ? [['Model / specs', request.specs] as [string, string]] : []),
    ...(request.description ? [['Description', request.description] as [string, string]] : []),
    ['Seller', seller?.displayName ?? 'Unknown'],
    ['Submitted', `${submitted} (${tz})`],
    ['Media', `${photos} photo${photos === 1 ? '' : 's'}${videos ? `, ${videos} video` : ''}`],
    ...(listing ? [['Public listing', `${listing.title} (${moneyLabel(listing.priceCents)} asking)`] as [string, string]] : []),
  ];

  const attachments: NonNullable<EmailMessage['attachments']> = [];
  const cover = media.find((m) => m.kind === 'image');
  if (cover && kind === 'new_request' && cover.bytes <= MAX_INLINE_BYTES) {
    const bytes = await getPrivate(cover.storageKey).catch(() => null);
    if (bytes) {
      attachments.push({
        filename: `preview${cover.storageKey.slice(cover.storageKey.lastIndexOf('.'))}`,
        content: bytes.toString('base64'),
        contentType: cover.contentType,
        contentId: 'dibbs-preview',
      });
    }
  }

  const safety = 'This link opens the request after you sign in with a Dibbs staff account. It does not approve or send anything by itself.';
  const text =
    `${heading}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nReview it: ${link}\n\n${safety}`;
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#161513">` +
    `<h2 style="margin:0 0 12px">${esc(heading)}</h2>` +
    (attachments.length
      ? `<p><img src="cid:dibbs-preview" alt="Photo of ${esc(request.itemName)}" style="max-width:320px;border-radius:8px"></p>`
      : '') +
    `<table style="border-collapse:collapse">${rows
      .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6F6A62;vertical-align:top">${esc(k)}</td><td style="padding:4px 0;white-space:pre-wrap">${esc(v)}</td></tr>`)
      .join('')}</table>` +
    `<p style="margin:20px 0"><a href="${esc(link)}" style="background:#161513;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Review request</a></p>` +
    `<p style="color:#6F6A62;font-size:13px">${esc(safety)}</p></div>`;
  return { to, subject: `${heading}: ${request.itemName.slice(0, 60)}`, text, html, attachments };
}

async function sellerEmail(db: Db, request: DibbsOfferRequest, kind: SellerEmailKind, to: string): Promise<EmailMessage> {
  const link = `${env.webBaseUrl}/dibbs-offer/${request.id}`;
  const [campus] = await db.select().from(campuses).where(eq(campuses.id, request.campusId));
  const tz = campus?.timezone ?? 'America/Phoenix';
  const item = request.itemName;
  let subject: string;
  let body: string;
  if (kind === 'estimate') {
    const label = estimateLabel(request.estimateLowCents, request.estimateHighCents) ?? '';
    const kindWord = request.estimateLowCents === request.estimateHighCents ? 'an estimated offer of' : 'an estimated range of';
    const until = request.estimateExpiresAt
      ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(request.estimateExpiresAt)
      : null;
    subject = `Dibbs estimate for ${item.slice(0, 60)}`;
    body =
      `The Dibbs team sent ${kindWord} ${label} for "${item}".\n\n` +
      `This is an estimate, not a final price. If you agree to meet, Dibbs inspects the item at a campus meetup and then makes a final offer, which you can accept or decline.` +
      (until ? `\n\nThe estimate is open until ${until} (${tz}).` : '');
  } else if (kind === 'needs_info') {
    subject = `Dibbs has a question about ${item.slice(0, 60)}`;
    body = `The Dibbs team needs a little more information about "${item}" before making an estimate. Open your request to answer.`;
  } else if (kind === 'declined') {
    subject = `Update on your Dibbs request`;
    body = `Thanks for asking. Dibbs can't make an offer on "${item}" this time. You can still list it on Dibbs for other students.`;
  } else {
    const [spot] = request.meetupSpotId ? await db.select().from(meetupSpots).where(eq(meetupSpots.id, request.meetupSpotId)) : [];
    const when = request.meetupStartsAt
      ? new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone: tz }).format(request.meetupStartsAt)
      : 'a time to be confirmed';
    subject = kind === 'meetup_confirmed' ? 'Your meetup with Dibbs is confirmed' : 'Dibbs proposed a meetup time';
    body =
      (kind === 'meetup_confirmed' ? `Your campus meetup with Dibbs for "${item}" is set.` : `Dibbs proposed a campus meetup for "${item}". Open your request to accept it or suggest another time.`) +
      `\n\nWhen: ${when} (${tz})\nWhere: ${spot?.name ?? 'See your request'}${spot?.description ? ` — ${spot.description}` : ''}` +
      `\n\nAt the meetup Dibbs inspects the item and confirms a final offer. Nothing is sold until you accept that final price.`;
  }
  const text = `${body}\n\nView your request: ${link}\n\nYour request is private between you and the Dibbs team.`;
  return { to, subject, text };
}

/** Still worth sending? Rows whose state moved on become `skipped`. */
function stillCurrent(row: typeof dibbsOfferNotifications.$inferSelect, r: DibbsOfferRequest): boolean {
  if (row.audience === 'team') {
    if (row.kind === 'new_request') return true;
    if (row.kind === 'info_provided') return r.status === 'submitted' || r.status === 'in_review';
    return r.status === 'meetup_proposed' && r.meetupProposedBy === 'seller' && r.version === row.refVersion;
  }
  switch (row.kind) {
    case 'estimate':
      return r.status === 'offered' && r.estimateVersion === row.refVersion;
    case 'needs_info':
      return r.status === 'needs_info' && r.version === row.refVersion;
    case 'declined':
      return r.status === 'declined';
    case 'meetup_proposed':
      return r.status === 'meetup_proposed' && r.meetupProposedBy === 'dibbs' && r.version === row.refVersion;
    case 'meetup_confirmed':
      return r.status === 'meetup_confirmed' && r.version === row.refVersion;
    default:
      return false;
  }
}

let warnedNoTeamInbox = false;

export async function dispatchDibbsEmails(db: Db, now = new Date()): Promise<void> {
  await db
    .update(dibbsOfferNotifications)
    .set({ status: 'scheduled', updatedAt: now })
    .where(and(eq(dibbsOfferNotifications.status, 'sending'), lt(dibbsOfferNotifications.updatedAt, new Date(now.getTime() - 300_000))));
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(dibbsOfferNotifications)
      .where(and(eq(dibbsOfferNotifications.status, 'scheduled'), lte(dibbsOfferNotifications.sendAfter, now)))
      .orderBy(dibbsOfferNotifications.sendAfter)
      .limit(20)
      .for('update', { skipLocked: true });
    if (rows.length) {
      await tx
        .update(dibbsOfferNotifications)
        .set({ status: 'sending', updatedAt: now })
        .where(inArray(dibbsOfferNotifications.id, rows.map((r) => r.id)));
    }
    return rows;
  });

  for (const row of claimed) {
    const skip = () =>
      db.update(dibbsOfferNotifications).set({ status: 'skipped', updatedAt: now }).where(eq(dibbsOfferNotifications.id, row.id));
    try {
      const [request] = await db.select().from(dibbsOfferRequests).where(eq(dibbsOfferRequests.id, row.requestId));
      if (!request || !stillCurrent(row, request)) {
        await skip();
        continue;
      }
      let message: EmailMessage;
      if (row.audience === 'team') {
        const to = env.dibbsOffersEmail;
        if (!to) {
          if (!warnedNoTeamInbox) console.warn('[dibbs] DIBBS_OFFERS_EMAIL is not set; team alerts are skipped (requests are still saved).');
          warnedNoTeamInbox = true;
          await skip();
          continue;
        }
        message = await teamEmail(db, request, row.kind as TeamKind, to);
      } else {
        const [seller] = await db.select().from(users).where(eq(users.id, request.sellerId));
        if (!seller || seller.deletedAt || !seller.email) {
          await skip();
          continue;
        }
        message = await sellerEmail(db, request, row.kind as SellerEmailKind, seller.email);
      }
      await emailProvider().send({ ...message, idempotencyKey: row.id });
      await db.update(dibbsOfferNotifications).set({ status: 'sent', updatedAt: now }).where(eq(dibbsOfferNotifications.id, row.id));
    } catch {
      const attempts = row.attempts + 1;
      await db
        .update(dibbsOfferNotifications)
        .set({
          status: attempts >= 5 ? 'failed' : 'scheduled',
          attempts,
          sendAfter: new Date(now.getTime() + 2 ** (attempts - 1) * 60_000),
          updatedAt: now,
        })
        .where(eq(dibbsOfferNotifications.id, row.id));
      // No recipient or provider details in logs.
      console.error('[dibbs] email delivery failed', row.id);
    }
  }
}

export function startDibbsEmailDispatcher(db: Db) {
  if (env.nodeEnv === 'test') return;
  const timer = setInterval(() => {
    void dispatchDibbsEmails(db).catch(() => console.error('[dibbs] email dispatcher failed'));
  }, 30_000);
  timer.unref?.();
}
