/**
 * Best-effort email nudge to every configured moderator (MODERATOR_USER_IDS)
 * when a new report lands in the `reports` queue. Until now reports just sat
 * there until a moderator happened to open /moderation and look
 * (see docs/HANDOFF.md "Moderation").
 *
 * Same fire-and-forget contract as backend/notifications/send.ts: this never
 * throws, because a failed alert email must never fail the report itself.
 * Callers call it without `await` (`void notifyModeratorsOfReport(...)`);
 * the promise still resolves so a test can await it to inspect the result.
 */
import { eq, inArray } from 'drizzle-orm';

import type { Db } from '../db/client';
import { listings, reports, users } from '../db/schema';
import { env } from '../env';
import { emailProvider } from './provider';

export interface ModeratorAlertResult {
  /** Moderator addresses the alert was actually sent to. */
  sent: number;
  /** No MODERATOR_USER_IDS configured, or none of them have a stored email. */
  noRecipients: boolean;
}

const REASON_LABEL: Record<string, string> = {
  prohibited_item: 'prohibited item',
  scam: 'scam',
  harassment: 'harassment',
  no_show: 'no-show',
  other: 'other',
};

export async function notifyModeratorsOfReport(
  db: Db,
  report: typeof reports.$inferSelect,
): Promise<ModeratorAlertResult> {
  try {
    if (env.moderatorUserIds.length === 0) return { sent: 0, noRecipients: true };

    const moderators = await db
      .select({ email: users.email })
      .from(users)
      .where(inArray(users.id, env.moderatorUserIds));
    const recipients = [...new Set(moderators.map((m) => m.email).filter((e): e is string => !!e))];
    if (recipients.length === 0) return { sent: 0, noRecipients: true };

    let target = 'a member';
    if (report.targetListingId) {
      const [listing] = await db
        .select({ title: listings.title })
        .from(listings)
        .where(eq(listings.id, report.targetListingId))
        .limit(1);
      target = listing ? `the listing "${listing.title}"` : 'a listing';
    } else if (report.targetUserId) {
      target = 'a member';
    }

    const reasonLabel = REASON_LABEL[report.reason] ?? report.reason;
    const link = `${(process.env.EXPO_PUBLIC_WEB_BASE_URL ?? 'https://trydibbs.com').replace(/\/$/, '')}/moderation`;
    const text =
      `A new report was filed on Dibbs: ${reasonLabel}, against ${target}.\n\n` +
      (report.details ? `Reporter's details: ${report.details}\n\n` : '') +
      `Review it: ${link}`;
    const html =
      `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;color:#161513">` +
      `<p>A new report was filed on Dibbs: <strong>${reasonLabel}</strong>, against ${target}.</p>` +
      (report.details ? `<p style="color:#6F6A62">Reporter's details: ${report.details}</p>` : '') +
      `<p><a href="${link}">Review it in Moderation</a></p>` +
      `</div>`;

    let sent = 0;
    for (const to of recipients) {
      try {
        await emailProvider().send({ to, subject: `Dibbs report: ${reasonLabel}`, text, html });
        sent += 1;
      } catch {
        // Never log recipient addresses or report details.
        console.error('[email] moderator report alert delivery failed');
      }
    }
    return { sent, noRecipients: false };
  } catch {
    console.error('[email] moderator report alert failed');
    return { sent: 0, noRecipients: false };
  }
}
