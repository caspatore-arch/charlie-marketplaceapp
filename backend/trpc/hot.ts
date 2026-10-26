/**
 * The "Hottest" ranking recipe, shared by Community posts and Browse listings
 * so both surfaces rank by the same rule (see docs/CONTRACT.md "Likes, shares
 * and Hottest"). Each activity row (a like, a comment, a share, ...) is
 * weighted by 0.5^(ageMinutes / HOT_HALF_LIFE_MIN) of its own timestamp, so
 * something from the last few minutes counts ~1, from an hour ago ~0.25, and
 * anything older than HOT_WINDOW_HOURS counts 0. The score depends on the
 * clock, so callers freeze `asOf` in their cursor and score every page at that
 * same instant.
 */
import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

export const HOT_HALF_LIFE_MIN = 30;
export const HOT_WINDOW_HOURS = 6;
export const HOT_COMMENT_WEIGHT = 2;
export const HOT_COMMENT_VOTE_WEIGHT = 0.5;

/** `sum` of the time-decayed weight of every row in the group, as a float8 (0 when none qualify). With `weight` (e.g. a vote's +1/-1) each row counts weight x decay. */
export function decayedSum(asOfIso: string, col: AnyColumn, weight?: SQL | AnyColumn) {
  return sql<number>`coalesce(sum(${weight ? sql`${weight}::float8 * ` : sql``}power(0.5, extract(epoch from (${asOfIso}::timestamptz - ${col})) / ${HOT_HALF_LIFE_MIN * 60}::float8)) filter (where ${col} <= ${asOfIso}::timestamptz and ${col} > ${asOfIso}::timestamptz - make_interval(hours => ${HOT_WINDOW_HOURS})), 0)::float8`;
}
