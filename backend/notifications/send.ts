/**
 * Preference-aware, fire-and-forget push sending.
 *
 * `notifyUsers` is the one function every event helper in `./events.ts`
 * calls. It:
 *   1. drops any recipient whose `notification_preferences` row turns the
 *      category off (a missing row defaults every category to on),
 *   2. loads every registered device for the remaining recipients,
 *   3. sends in batches of <=100 via `sendExpoPushBatch`,
 *   4. deletes any token Expo reports as `DeviceNotRegistered`.
 *
 * It never throws — a push failure must never fail the bid/message/accept
 * that triggered it (see docs/HANDOFF.md "Reminders / push: Not implemented"
 * and the task brief). Callers should call it without `await`
 * (`void notifyUsers(...)`) from inside a mutation; the promise still
 * resolves so a test can `await` it to inspect what happened.
 */
import { eq, inArray } from 'drizzle-orm';

import type { Db } from '../db/client';
import { deviceTokens, notificationPreferences } from '../db/schema';
import { chunk, sendExpoPushBatch, type ExpoPushMessage, type PushFetch } from './expoPush';

export type NotificationCategory = 'messages' | 'meetups' | 'auctions' | 'offers';

export interface NotifyInput {
  /** Recipients, already filtered by the caller for anything not preference-related
   * (never the actor themselves, never a blocked user). */
  userIds: string[];
  category: NotificationCategory;
  title: string;
  body: string;
  /** Extra payload delivered to the client, e.g. `{ path: '/conversation/123' }' for deep-linking. */
  data: Record<string, unknown>;
}

export interface NotifyResult {
  /** Number of device tokens a push was actually sent to. */
  sent: number;
  /** Tokens deleted because Expo reported DeviceNotRegistered. */
  removedTokens: string[];
  /** Recipients skipped because they turned this category off. */
  suppressedForPreference: string[];
}

export interface NotifyDeps {
  send?: (messages: ExpoPushMessage[], fetchImpl?: PushFetch) => ReturnType<typeof sendExpoPushBatch>;
  fetchImpl?: PushFetch;
}

const EMPTY_RESULT: NotifyResult = { sent: 0, removedTokens: [], suppressedForPreference: [] };

/** True when `category` is enabled for `pref` — a missing row means everything is on. */
function categoryEnabled(
  category: NotificationCategory,
  pref: { messages: boolean; meetups: boolean; auctions: boolean; offers: boolean } | undefined,
): boolean {
  if (!pref) return true;
  return pref[category];
}

export async function notifyUsers(db: Db, input: NotifyInput, deps: NotifyDeps = {}): Promise<NotifyResult> {
  try {
    if (input.userIds.length === 0) return EMPTY_RESULT;
    const recipientIds = [...new Set(input.userIds)];

    const prefRows = await db
      .select()
      .from(notificationPreferences)
      .where(inArray(notificationPreferences.userId, recipientIds));
    const prefByUser = new Map(prefRows.map((p) => [p.userId, p]));

    const suppressedForPreference: string[] = [];
    const allowedIds = recipientIds.filter((id) => {
      const ok = categoryEnabled(input.category, prefByUser.get(id));
      if (!ok) suppressedForPreference.push(id);
      return ok;
    });
    if (allowedIds.length === 0) {
      return { sent: 0, removedTokens: [], suppressedForPreference };
    }

    const tokenRows = await db
      .select()
      .from(deviceTokens)
      .where(inArray(deviceTokens.userId, allowedIds));
    if (tokenRows.length === 0) {
      return { sent: 0, removedTokens: [], suppressedForPreference };
    }

    const messages: ExpoPushMessage[] = tokenRows.map((t) => ({
      to: t.expoPushToken,
      title: input.title,
      body: input.body,
      data: input.data,
      sound: 'default',
    }));

    const send = deps.send ?? sendExpoPushBatch;
    const batches = chunk(messages, 100);
    const tokenBatches = chunk(tokenRows, 100);

    let sent = 0;
    const removedTokens: string[] = [];

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]!;
      const tokensInBatch = tokenBatches[i]!;
      const tickets = await send(batch, deps.fetchImpl);

      const toRemove: string[] = [];
      tickets.forEach((ticket, idx) => {
        if (ticket.status === 'ok') {
          sent += 1;
          return;
        }
        if (ticket.details?.error === 'DeviceNotRegistered') {
          const tok = tokensInBatch[idx]?.expoPushToken;
          if (tok) toRemove.push(tok);
        } else {
          console.error('[notifications] push ticket error', ticket.message, ticket.details);
        }
      });

      if (toRemove.length > 0) {
        await db.delete(deviceTokens).where(inArray(deviceTokens.expoPushToken, toRemove));
        removedTokens.push(...toRemove);
      }
    }

    return { sent, removedTokens, suppressedForPreference };
  } catch (err) {
    // Sending must never break the action that triggered it.
    console.error('[notifications] notifyUsers failed', err);
    return EMPTY_RESULT;
  }
}
