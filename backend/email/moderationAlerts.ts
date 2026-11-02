/**
 * Best-effort email to moderators when a report is filed, so they don't have
 * to keep refreshing /moderation to notice one (docs/HANDOFF.md §3: "No
 * email alerts to the moderator; they have to look.").
 *
 * Never throws, so callers can simply `await` it without risking the report
 * mutation itself — same contract as backend/notifications/send.ts for push.
 */
import { inArray } from 'drizzle-orm';

import type { Db } from '../db/client';
import { users, type Report } from '../db/schema';
import { emailProvider } from './provider';
import { env } from '../env';

const REASON_LABEL: Record<Report['reason'], string> = {
  prohibited_item: 'Prohibited item',
  scam: 'Scam',
  harassment: 'Harassment',
  no_show: 'No-show',
  other: 'Other',
};

export async function notifyModeratorsOfReport(db: Db, report: Report): Promise<void> {
  try {
    const moderatorIds = env.moderatorUserIds;
    if (moderatorIds.length === 0) return;

    const moderators = await db.select().from(users).where(inArray(users.id, moderatorIds));
    const recipients = moderators.filter((m) => m.email && !m.deletedAt);
    if (recipients.length === 0) return;

    const link = `${(process.env.EXPO_PUBLIC_WEB_BASE_URL ?? 'https://trydibbs.com').replace(/\/$/, '')}/moderation`;
    const reason = REASON_LABEL[report.reason] ?? report.reason;
    const what = report.targetListingId ? 'a listing' : report.targetPostId ? 'a community post' : 'a user';
    const subject = `New report: ${reason}`;
    const text = `A new report was filed against ${what} on Dibbs.\n\nReason: ${reason}${report.details ? `\nDetails: ${report.details}` : ''}\n\nReview it: ${link}`;

    await Promise.all(
      recipients.map((m) =>
        emailProvider()
          .send({ to: m.email!, subject, text, idempotencyKey: `report:${report.id}:${m.id}` })
          .catch((err) => {
            // One moderator's bad address must never stop the others.
            console.error('[email] moderator report alert failed', err instanceof Error ? err.message : err);
          }),
      ),
    );
  } catch (err) {
    console.error('[email] notifyModeratorsOfReport failed', err instanceof Error ? err.message : err);
  }
}
