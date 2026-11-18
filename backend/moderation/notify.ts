/**
 * Best-effort email alert when a report is filed, so a moderator does not
 * have to keep checking the queue by hand (docs/HANDOFF.md "Moderation").
 * Simulated by default like every other email in this repo (backend/email/provider.ts).
 * Never throws and never blocks the report mutation that triggered it — the
 * same promise backend/notifications/send.ts makes for push.
 */
import { inArray } from 'drizzle-orm';

import type { Db } from '../db/client';
import { users } from '../db/schema';
import { emailProvider, type EmailMessage } from '../email/provider';
import { env } from '../env';

export type ReportTarget = 'user' | 'listing' | 'post';

function reportAlertEmail(to: string, target: ReportTarget, reason: string): EmailMessage {
  const what = target === 'listing' ? 'a listing' : target === 'post' ? 'a community post' : 'a user';
  const text =
    `A new report was filed on Dibbs against ${what}. Reason: ${reason}.\n\n` +
    `Sign in to the moderation queue in the app to review it.`;
  return { to, subject: `Dibbs: new report (${reason})`, text };
}

/** Recipients: each MODERATOR_USER_IDS account's own email, plus MODERATION_ALERT_EMAIL if set. */
async function alertRecipients(db: Db): Promise<string[]> {
  const addresses = new Set<string>();
  if (env.moderatorUserIds.length > 0) {
    const rows = await db.select({ email: users.email }).from(users).where(inArray(users.id, env.moderatorUserIds));
    for (const row of rows) if (row.email) addresses.add(row.email);
  }
  if (env.moderationAlertEmail) addresses.add(env.moderationAlertEmail);
  return [...addresses];
}

export async function alertModeratorsOfReport(db: Db, input: { target: ReportTarget; reason: string }): Promise<void> {
  try {
    const recipients = await alertRecipients(db);
    if (recipients.length === 0) return; // No moderator configured — the report is still saved.
    await Promise.all(
      recipients.map((to) => emailProvider().send(reportAlertEmail(to, input.target, input.reason))),
    );
  } catch (err) {
    console.error('[moderation] report alert email failed:', err instanceof Error ? err.message : err);
  }
}
