/**
 * Site visit counter for the founder dashboard. The app sends one
 * POST /api/visit when it opens (once per browser tab on the web, once per
 * launch on a phone). We only bump a per-day, per-platform counter: no IP,
 * account or device id is stored.
 */
import { and, gte, sql, sum } from 'drizzle-orm';

import { db } from '../db/client';
import { siteVisits } from '../db/schema';

const TZ = 'America/Phoenix';
const PLATFORMS = ['web', 'ios', 'android'] as const;
export type VisitPlatform = (typeof PLATFORMS)[number];

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayOf = (msAgo = 0) => dayFmt.format(new Date(Date.now() - msAgo));

export function parsePlatform(v: string | undefined): VisitPlatform | null {
  return (PLATFORMS as readonly string[]).includes(v ?? '') ? (v as VisitPlatform) : null;
}

export async function recordVisit(platform: VisitPlatform): Promise<void> {
  await db
    .insert(siteVisits)
    .values({ day: dayOf(), platform, visits: 1 })
    .onConflictDoUpdate({
      target: [siteVisits.day, siteVisits.platform],
      set: { visits: sql`${siteVisits.visits} + 1` },
    });
}

/** Totals plus a gap-filled daily series for the last `days` days. */
export async function getVisitStats(days = 30) {
  const since = (n: number) => dayOf(n * 86_400_000);
  const [rows, [all]] = await Promise.all([
    db
      .select({ day: siteVisits.day, platform: siteVisits.platform, visits: siteVisits.visits })
      .from(siteVisits)
      .where(and(gte(siteVisits.day, since(days - 1)))),
    db.select({ n: sum(siteVisits.visits) }).from(siteVisits),
  ]);

  const byDay = new Map<string, number>();
  const byPlatform: Record<VisitPlatform, number> = { web: 0, ios: 0, android: 0 };
  for (const r of rows) {
    byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.visits);
    if (r.platform in byPlatform) byPlatform[r.platform as VisitPlatform] += r.visits;
  }
  const series: { day: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = since(i);
    series.push({ day, count: byDay.get(day) ?? 0 });
  }
  const lastN = (n: number) => series.slice(-n).reduce((t, d) => t + d.count, 0);

  return {
    total: Number(all?.n ?? 0),
    today: lastN(1),
    last7Days: lastN(7),
    last30Days: lastN(days),
    last30ByPlatform: byPlatform,
    daily: series,
  };
}
