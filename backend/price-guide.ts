/**
 * Price guide for the Sell form: what similar items on Dibbs are listed or
 * sold for. Feeds the red / orange / green bar under "Asking price".
 *
 * "Similar" means the same category, narrowed to listings that share a title
 * word when at least MIN_COMPARABLES of those exist. The average is a trimmed
 * mean so one $400 outlier does not drag a $15 lamp's guide upward.
 */
import { and, desc, eq, gte, inArray } from 'drizzle-orm';

import type { Db } from './db/client';
import { listings, users } from './db/schema';

export const MIN_COMPARABLES = 3;
const SAMPLE_SIZE = 300;

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'new', 'used', 'like', 'size', 'good', 'great', 'condition',
  'set', 'pair', 'mens', 'womens', 'small', 'medium', 'large', 'from', 'only', 'very',
]);

export function titleWords(title: string): string[] {
  return [
    ...new Set(
      title
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
    ),
  ];
}

/** Mean after dropping the top and bottom 10% (only once there are 10+ prices). */
export function trimmedMean(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const cut = sorted.length >= 10 ? Math.floor(sorted.length * 0.1) : 0;
  const kept = sorted.slice(cut, sorted.length - cut);
  return Math.round(kept.reduce((s, v) => s + v, 0) / kept.length);
}

export interface PriceGuide {
  /** How many listings the average is based on. 0 means not enough data. */
  count: number;
  averageCents: number | null;
  basis: 'similar_titles' | 'category' | null;
  /** Some comparables are seeded demo listings, so the UI must say so. */
  includesDemo: boolean;
}

export async function priceGuide(
  db: Db,
  input: { category: string; title?: string; excludeListingId?: string },
): Promise<PriceGuide> {
  const rows = await db
    .select({
      id: listings.id,
      title: listings.title,
      priceCents: listings.priceCents,
      isDemo: users.isDemo,
    })
    .from(listings)
    .innerJoin(users, eq(users.id, listings.sellerId))
    .where(
      and(
        eq(listings.category, input.category as (typeof listings.category.enumValues)[number]),
        eq(listings.saleType, 'fixed'),
        inArray(listings.status, ['active', 'reserved', 'sold', 'expired']),
        gte(listings.priceCents, 100),
      ),
    )
    .orderBy(desc(listings.createdAt))
    .limit(SAMPLE_SIZE);

  const pool = rows.filter((r) => r.id !== input.excludeListingId);
  const words = titleWords(input.title ?? '');
  const similar =
    words.length > 0 ? pool.filter((r) => titleWords(r.title).some((w) => words.includes(w))) : [];

  const [chosen, basis] =
    similar.length >= MIN_COMPARABLES
      ? [similar, 'similar_titles' as const]
      : [pool, 'category' as const];

  if (chosen.length < MIN_COMPARABLES) {
    return { count: 0, averageCents: null, basis: null, includesDemo: false };
  }
  return {
    count: chosen.length,
    averageCents: trimmedMean(chosen.map((r) => r.priceCents)),
    basis,
    includesDemo: chosen.some((r) => r.isDemo),
  };
}
