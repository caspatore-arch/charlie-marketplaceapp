import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users, smsMessages } from '../db/schema';
import { env } from '../env';

/** Twilio form POST signature: exact public URL + sorted form names and values. */
export function validTwilioSignature(url: string, params: URLSearchParams, signature: string, token: string) {
  const keys = [...new Set(params.keys())].sort();
  // Standard Messaging callbacks have one value per name. Reject ambiguous duplicates.
  if (keys.some((key) => params.getAll(key).length !== 1)) return false;
  const payload = url + keys.map((key) => key + params.get(key)).join('');
  const expected = Buffer.from(createHmac('sha1', token).update(payload).digest('base64'));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function handleSmsOptOut(db: Db, raw: string, signature: string) {
  const url = process.env.TWILIO_INBOUND_WEBHOOK_URL;
  if (!url || !env.twilioAuthToken) return 503;
  const params = new URLSearchParams(raw);
  if (!validTwilioSignature(url, params, signature, env.twilioAuthToken) || params.get('AccountSid') !== env.twilioAccountSid) return 403;
  const optOut = params.get('OptOutType')?.toUpperCase();
  const body = params.get('Body')?.trim().toUpperCase();
  if (optOut !== 'STOP' && !['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT'].includes(body ?? '')) return 200;
  const phone = params.get('From');
  if (!phone) return 400;
  await db.transaction(async (tx) => {
    const people = await tx.update(users).set({ smsOptIn: false, smsOptOutAt: new Date() })
      .where(eq(users.phone, phone)).returning({ id: users.id });
    for (const person of people) await tx.update(smsMessages).set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(smsMessages.userId, person.id), eq(smsMessages.status, 'scheduled')));
  });
  // START deliberately does not restore app consent; the person can opt in in settings.
  return 200;
}
