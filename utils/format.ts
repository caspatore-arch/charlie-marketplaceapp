/**
 * Formatting helpers. Keep pure and dependency-light so any screen can use
 * them without pulling in extra state.
 */
import type { Category, Condition } from '@/constants/campus';
import { CATEGORY_LABELS, CONDITION_LABELS } from '@/constants/campus';

/** Formats integer cents as a whole-dollar price string, e.g. 1999 -> "$19.99". */
export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString('en-US', {
    minimumFractionDigits: dollars % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Formats an ISO date/timestamp as a short relative string, e.g. "2h ago", "Just now", "3d ago". */
export function formatRelative(date: string | Date): string {
  const then = typeof date === 'string' ? new Date(date) : date;
  const diffMs = Date.now() - then.getTime();
  const diffSec = Math.round(diffMs / 1000);

  if (diffSec < 30) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  const diffWeek = Math.round(diffDay / 7);
  if (diffWeek < 5) return `${diffWeek}w ago`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Formats an ISO meetup time for display, e.g. "Today, 3:30 PM" / "Fri, Sep 19, 2:00 PM".
 * `timeZone` is an IANA name (e.g. "America/Phoenix") from the campus record; when
 * omitted the device's local time zone is used.
 */
export function formatMeetupTime(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  const now = new Date();

  const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' });
  const isSameDay = dayFmt.format(date) === dayFmt.format(now);

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = dayFmt.format(date) === dayFmt.format(tomorrow);

  const timePart = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);

  if (isSameDay) return `Today, ${timePart}`;
  if (isTomorrow) return `Tomorrow, ${timePart}`;

  const datePart = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);

  return `${datePart}, ${timePart}`;
}

/** Human label for a listing condition enum value. */
export function conditionLabel(condition: Condition | string): string {
  return CONDITION_LABELS[condition as Condition] ?? condition;
}

/** Human label for a listing category enum value. */
export function categoryLabel(category: Category | string): string {
  return CATEGORY_LABELS[category as Category] ?? category;
}
