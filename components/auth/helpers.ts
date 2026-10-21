/** Small helpers shared by the phone / campus-email auth components. */

/** Formats US numbers as the user types: "(520) 555-0123". "+" numbers are left as typed. */
export function formatPhoneInput(text: string): string {
  if (text.trim().startsWith('+')) return text.replace(/[^\d+\s()-]/g, '');
  let d = text.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length === 0) return '';
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Returns an error message when the number is obviously unusable, else undefined. */
export function phoneProblem(text: string): string | undefined {
  const t = text.trim();
  if (!t) return 'Enter your mobile number.';
  const digits = t.replace(/\D/g, '');
  if (t.startsWith('+') ? digits.length < 8 : digits.length < 10) {
    return 'Enter a 10-digit US phone number, or start with + and your country code.';
  }
  return undefined;
}

/** "(520) 555-0123" / "+15205550123" -> "•••-•••-0123" (last 4 only). */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return `•••-•••-${phone.replace(/\D/g, '').slice(-4)}`;
}

export interface FriendlyError {
  message: string;
  /** tRPC error code, e.g. TOO_MANY_REQUESTS, when the server produced one. */
  code?: string;
  network: boolean;
}

export function describeError(e: unknown, fallback: string): FriendlyError {
  const message = e instanceof Error && e.message ? e.message : fallback;
  const code = (e as { data?: { code?: string } } | null)?.data?.code;
  return { message, code, network: /^Can't reach the server/.test(message) };
}

/** Pulls a wait time out of "Wait 12s…" / "try again in 5 minutes" style messages. */
export function secondsFromMessage(message: string): number | undefined {
  const m = /(\d+)\s*(s\b|sec|second|m\b|min|minute|h\b|hour)/i.exec(message);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  if (unit.startsWith('h')) return n * 3600;
  if (unit.startsWith('m')) return n * 60;
  return n;
}
