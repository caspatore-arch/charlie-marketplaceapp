/**
 * Low-level transport to Expo's push service. No SDK dependency — plain
 * `fetch` against `https://exp.host/--/api/v2/push/send`, per Expo's docs.
 *
 * Kept deliberately dumb: batching, chunking and preference/token bookkeeping
 * live in `./send.ts`. This file only knows how to talk to Expo and how to
 * read its response shape.
 */

/** One outbound push, in Expo's wire format. */
export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
}

export interface ExpoPushTicketOk {
  status: 'ok';
  id: string;
}

export interface ExpoPushTicketError {
  status: 'error';
  message: string;
  details?: { error?: string };
}

export type ExpoPushTicket = ExpoPushTicketOk | ExpoPushTicketError;

/** Expo accepts at most 100 messages per request. */
export const EXPO_PUSH_BATCH_SIZE = 100;

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

/** Injectable so the notifications-check script can run against a fake transport. */
export type PushFetch = typeof fetch;

/**
 * Sends one batch (<=100) of messages and returns one ticket per message, in
 * the same order. Never throws on a per-message send error — Expo reports
 * those inside `data[]` with `status: 'error'`. Only a transport-level failure
 * (network error, non-2xx with no body, malformed JSON) throws, and the
 * caller (`send.ts`) is responsible for catching that so a push failure never
 * takes down the action that triggered it.
 */
export async function sendExpoPushBatch(
  messages: ExpoPushMessage[],
  fetchImpl: PushFetch = fetch,
): Promise<ExpoPushTicket[]> {
  if (messages.length === 0) return [];
  if (messages.length > EXPO_PUSH_BATCH_SIZE) {
    throw new Error(
      `sendExpoPushBatch received ${messages.length} messages; chunk to ${EXPO_PUSH_BATCH_SIZE} or fewer before calling.`,
    );
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  // Optional: raises Expo's rate limits. Not required for basic sending.
  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetchImpl(EXPO_PUSH_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Expo push service returned ${response.status}: ${text.slice(0, 500)}`);
  }

  const body = (await response.json()) as { data?: ExpoPushTicket[]; errors?: unknown[] };
  if (!Array.isArray(body.data)) {
    throw new Error('Expo push service returned an unexpected response shape.');
  }
  return body.data;
}

/** Splits an array into chunks of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
