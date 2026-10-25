/**
 * Campus-timezone helpers for booking. Meetup times are stored as UTC instants
 * and must always be DISPLAYED in the campus timezone (`slots.timezone`), never
 * the device's. Everything here takes an explicit IANA `timeZone`.
 */

export const SLOT_MS = 15 * 60_000;
export const DAY_MS = 24 * 60 * 60_000;

type DateLike = Date | string | number;

function toDate(d: DateLike): Date {
  return d instanceof Date ? d : new Date(d);
}

/** Stable per-day key (YYYY-MM-DD) in the given time zone. */
export function dayKey(d: DateLike, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(toDate(d));
}

/** "Today" / "Tomorrow" / "Wed" relative to now, in the campus time zone. */
export function relativeDayLabel(d: DateLike, timeZone?: string, now: Date = new Date()): string {
  const key = dayKey(d, timeZone);
  if (key === dayKey(now, timeZone)) return 'Today';
  // Anything in the rolling 24h after now that is not today is "tomorrow".
  if (key === dayKey(new Date(now.getTime() + DAY_MS), timeZone)) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(toDate(d));
}

/** "Tue, Oct 20" */
export function shortDate(d: DateLike, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(toDate(d));
}

/** "3:30 PM" */
export function clockTime(d: DateLike, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(toDate(d));
}

/** "Today, Tue Oct 20 · 3:30 – 4:00 PM" — the exact agreed time, in campus time. */
export function exactMeetupTime(startsAt: DateLike, timeZone?: string, slotMs: number = SLOT_MS): string {
  const start = toDate(startsAt);
  const end = new Date(start.getTime() + slotMs);
  const day = relativeDayLabel(start, timeZone);
  const date = shortDate(start, timeZone);
  const dayPart = day === date.split(',')[0] ? date : `${day}, ${date}`;
  return `${dayPart} · ${clockTime(start, timeZone)} – ${clockTime(end, timeZone)}`;
}

/** "Today at 3:30 PM" style short form used in notes and history rows. */
export function shortWhen(d: DateLike, timeZone?: string): string {
  return `${relativeDayLabel(d, timeZone)} ${clockTime(d, timeZone)}`;
}

/** Short zone name such as "MST" for captions. Empty string if unavailable. */
export function zoneAbbreviation(timeZone?: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? '';
  } catch {
    return '';
  }
}

/** Next quarter-hour boundary at or after `from`. */
export function nextSlotBoundary(from: Date = new Date()): Date {
  return new Date(Math.ceil(from.getTime() / SLOT_MS) * SLOT_MS);
}

/** Every 15-minute start from the next boundary until now + 24h. */
export function rollingDaySlotStarts(now: Date = new Date()): Date[] {
  const out: Date[] = [];
  const end = now.getTime() + DAY_MS;
  for (let t = nextSlotBoundary(now).getTime(); t + SLOT_MS <= end; t += SLOT_MS) out.push(new Date(t));
  return out;
}

/**
 * Every 15-minute start a buyer may propose on an archived listing: from the
 * next quarter hour that is at least `leadMinutes` away, up to `days` days
 * ahead, and only inside 7:00 AM - 11:00 PM campus time (a meetup must end by
 * 11 PM, so the last start is 10:45 PM). Matches the server's rule for a
 * buyer-proposed time: on the 15-minute grid, in the future, at most 7 days out.
 */
export function proposalSlotStarts(
  timeZone: string | undefined,
  now: Date = new Date(),
  opts: { days?: number; leadMinutes?: number; openHour?: number; closeHour?: number } = {},
): Date[] {
  const { days = 7, leadMinutes = 30, openHour = 7, closeHour = 23 } = opts;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });
  const out: Date[] = [];
  const end = now.getTime() + days * DAY_MS;
  const first = nextSlotBoundary(new Date(now.getTime() + leadMinutes * 60_000)).getTime();
  for (let t = first; t <= end; t += SLOT_MS) {
    const parts = fmt.formatToParts(new Date(t));
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    const minuteOfDay = hour * 60 + minute;
    if (minuteOfDay >= openHour * 60 && minuteOfDay + SLOT_MS / 60_000 <= closeHour * 60) out.push(new Date(t));
  }
  return out;
}

/**
 * Whole-dollar-and-cents text -> integer cents. Returns null when the text is
 * not a plain amount (so callers can show their own message).
 */
export function parseDollarsToCents(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(Number.parseFloat(cleaned) * 100);
}
