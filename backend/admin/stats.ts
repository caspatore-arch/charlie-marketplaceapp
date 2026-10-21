/**
 * Founder dashboard data, served only behind the admin password
 * (backend/admin/routes.ts). Counts, not people: the only
 * personal detail returned is a display name and join date for the latest
 * sign-ups — never an email or phone number.
 *
 * "Real" accounts exclude seeded demo users and closed (anonymized) accounts.
 */
import { and, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { env } from '../env';
import { db, dbKind } from '../db/client';
import { communityPosts, listings, messages, users } from '../db/schema';
import { resolveEmailMode } from '../email/provider';

/** Days are counted in campus time so "today" matches what the founder sees. */
const TZ = 'America/Phoenix';
const DAYS = 30;

/** Turn a connection string into a host-only label — never the password. */
function databaseLabel(): { provider: string; host: string | null } {
  if (dbKind === 'pglite') {
    return { provider: 'PGlite file on the server disk (local / demo mode)', host: null };
  }
  let host = '';
  try {
    host = new URL(env.databaseUrl ?? '').hostname;
  } catch {
    // unparseable — leave blank
  }
  const provider = host.includes('neon.tech')
    ? 'Neon Postgres'
    : host.includes('railway') || host.includes('rlwy.net')
      ? 'Railway Postgres'
      : host.includes('supabase')
        ? 'Supabase Postgres'
        : host.includes('render.com')
          ? 'Render Postgres'
          : 'Postgres';
  return { provider, host: host || null };
}

function photoStorageLabel(): { provider: string; location: string } {
  if (!env.s3Bucket) {
    return { provider: 'Server disk', location: env.uploadsDir };
  }
  const endpoint = env.s3Endpoint ?? '';
  const provider = endpoint.includes('r2.cloudflarestorage')
    ? 'Cloudflare R2'
    : endpoint.includes('backblaze')
      ? 'Backblaze B2'
      : endpoint
        ? 'S3-compatible storage'
        : 'Amazon S3';
  return { provider, location: `bucket "${env.s3Bucket}"${env.s3Region ? ` (${env.s3Region})` : ''}` };
}

export async function getAdminStats() {
  const ctx = { db };
  {
    const real = and(eq(users.isDemo, false), isNull(users.deletedAt));
    const since = (days: number) =>
      sql`${users.createdAt} >= (date_trunc('day', now() at time zone ${TZ}) - make_interval(days => ${days})) at time zone ${TZ}`;

    const [
      [totals],
      [demo],
      [closed],
      [today],
      [week],
      [month],
      [viaEmail],
      [viaPhone],
      [withProfile],
      daily,
      recent,
      [listingCount],
      [postCount],
      [messageCount],
    ] = await Promise.all([
      ctx.db.select({ n: count() }).from(users).where(real),
      ctx.db.select({ n: count() }).from(users).where(eq(users.isDemo, true)),
      ctx.db.select({ n: count() }).from(users).where(isNotNull(users.deletedAt)),
      ctx.db.select({ n: count() }).from(users).where(and(real, since(0))),
      ctx.db.select({ n: count() }).from(users).where(and(real, since(6))),
      ctx.db.select({ n: count() }).from(users).where(and(real, since(DAYS - 1))),
      ctx.db.select({ n: count() }).from(users).where(and(real, isNotNull(users.campusEmailVerifiedAt))),
      ctx.db.select({ n: count() }).from(users).where(and(real, isNotNull(users.phoneVerifiedAt))),
      ctx.db
        .select({ n: count() })
        .from(users)
        .where(and(real, sql`(${users.avatarUrl} is not null or coalesce(${users.bio}, '') <> '')`)),
      ctx.db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${users.createdAt} at time zone ${TZ}), 'YYYY-MM-DD')`,
          n: count(),
        })
        .from(users)
        .where(and(real, since(DAYS - 1)))
        .groupBy(sql`1`)
        .orderBy(sql`1`),
      ctx.db
        .select({ id: users.id, displayName: users.displayName, createdAt: users.createdAt, avatarUrl: users.avatarUrl })
        .from(users)
        .where(real)
        .orderBy(desc(users.createdAt))
        .limit(10),
      ctx.db.select({ n: count() }).from(listings),
      ctx.db.select({ n: count() }).from(communityPosts),
      ctx.db.select({ n: count() }).from(messages),
    ]);

    // Fill gaps so the chart always shows all 30 days, zeros included.
    const byDay = new Map(daily.map((d) => [d.day, Number(d.n)]));
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
    const series: { day: string; count: number }[] = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      const day = fmt.format(new Date(Date.now() - i * 86_400_000));
      series.push({ day, count: byDay.get(day) ?? 0 });
    }

    return {
      generatedAt: new Date(),
      accounts: {
        total: Number(totals!.n),
        today: Number(today!.n),
        last7Days: Number(week!.n),
        last30Days: Number(month!.n),
        verifiedCampusEmail: Number(viaEmail!.n),
        verifiedPhone: Number(viaPhone!.n),
        withProfile: Number(withProfile!.n),
        demo: Number(demo!.n),
        closed: Number(closed!.n),
      },
      daily: series,
      recent,
      activity: {
        listings: Number(listingCount!.n),
        communityPosts: Number(postCount!.n),
        messages: Number(messageCount!.n),
      },
      storage: {
        database: databaseLabel(),
        photos: photoStorageLabel(),
        signInEmail: resolveEmailMode().mode,
      },
    };
  }
}

export type AdminStats = Awaited<ReturnType<typeof getAdminStats>>;
