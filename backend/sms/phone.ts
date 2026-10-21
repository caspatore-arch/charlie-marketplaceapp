/**
 * Phone number normalization to E.164. Pilot scope is US/Canada (+1): a bare
 * 10-digit number is read as +1. Anything else must already start with "+".
 * Deliberately strict rather than "clever" — a wrong guess texts a stranger.
 */
export class PhoneFormatError extends Error {}

export function normalizePhone(input: string): string {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!hasPlus) {
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    throw new PhoneFormatError('Enter a 10-digit US phone number, or start with + and your country code.');
  }
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) {
    throw new PhoneFormatError('That phone number does not look right.');
  }
  if (digits.startsWith('1') && digits.length !== 11) {
    throw new PhoneFormatError('A US number has 10 digits after +1.');
  }
  return `+${digits}`;
}

/** "+15205551234" → "•••-•••-1234" for logs and UI. Never log a full number. */
export function maskPhone(e164: string): string {
  return `•••-•••-${e164.slice(-4)}`;
}
