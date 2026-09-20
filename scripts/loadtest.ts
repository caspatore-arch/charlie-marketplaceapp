/**
 * Load and scaling harness.
 *
 *   npx tsx scripts/loadtest.ts --scale=1 --concurrency=32 --seconds=20
 *
 * Boots the real Hono app in-process against a throwaway datadir, bulk-seeds a
 * steady-state campus (see scripts/bulk-seed.ts), then drives a realistic
 * traffic mix and reports per-endpoint latency percentiles plus queries per
 * request.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 *
 * Locally the database is PGlite: Postgres compiled to WASM, in-process, one
 * connection, no parallelism. So the absolute RPS here is a floor, not a
 * forecast, and nothing about lock contention or connection-pool behaviour can
 * be observed. What it does measure honestly, because it runs the real router
 * against real SQL:
 *
 *   - queries per request        an N+1 shows up as a number, not a hunch
 *   - writes on a read path      counted separately; these block read replicas
 *   - latency vs. dataset size   run two scales; flat is good, rising is an
 *                                index problem that Postgres will share
 *
 * Point DATABASE_URL at a real Postgres and the same script measures true
 * concurrency, which is the run that should gate a production launch.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-swap-load-'));
if (!process.env.DATABASE_URL) {
  process.env.PGLITE_DIR = path.join(tempRoot, 'pg');
}
process.env.UPLOADS_DIR = path.join(tempRoot, 'uploads');
process.env.PORT = '0';
process.env.DEV_LOGIN = '1';
// Installs the drizzle query logger; counting stays off until a probe turns it
// on, so the throughput phase is not measuring the instrumentation.
process.env.SQL_TRACE = '1';
// Note: the limiter in backend/ratelimit.ts is only mounted on auth,
// checkAddress and uploads — none of the tRPC read paths driven below — so
// nothing here needs disabling. That gap is itself a finding.

/* ------------------------------------------------------------------ args */

function numArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.split('=')[1]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be positive`);
  return value;
}

const SCALE = numArg('scale', 1);
const CONCURRENCY = numArg('concurrency', 32);
const SECONDS = numArg('seconds', 20);

/* ------------------------------------------------------------ statistics */

class Samples {
  private readonly values: number[] = [];
  errors = 0;

  add(ms: number): void {
    this.values.push(ms);
  }

  get count(): number {
    return this.values.length;
  }

  /** Nearest-rank percentile. */
  percentile(p: number): number {
    if (this.values.length === 0) return 0;
    const sorted = [...this.values].sort((a, b) => a - b);
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(rank, sorted.length) - 1]!;
  }

  get mean(): number {
    if (this.values.length === 0) return 0;
    return this.values.reduce((a, b) => a + b, 0) / this.values.length;
  }
}

function fmt(ms: number): string {
  return `${ms.toFixed(1)}ms`.padStart(9);
}

/* -------------------------------------------------------------------- run */

async function main(): Promise<number> {
  const { createTRPCClient, httpLink } = await import('@trpc/client');
  const superjson = (await import('superjson')).default;
  const { serve } = await import('@hono/node-server');
  const { bulkSeed, sizingForScale } = await import('./bulk-seed');
  const { sqlStats, dbKind } = await import('../backend/db/client');
  const app = (await import('../backend/hono')).default;
  type AppRouter = import('../backend/trpc/app-router').AppRouter;

  const sizing = sizingForScale(SCALE);
  console.log(`\ncampus-swap load test — driver: ${dbKind}, scale ${SCALE}`);
  console.log(
    `dataset: ${sizing.users.toLocaleString()} users, ${sizing.listings.toLocaleString()} listings ` +
      `(${Math.round(sizing.listings * sizing.activeShare).toLocaleString()} active)\n`,
  );

  const seedStarted = Date.now();
  await bulkSeed(sizing);
  console.log(`seeded in ${((Date.now() - seedStarted) / 1000).toFixed(1)}s\n`);

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve(s as never));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}/api/trpc`;

  function clientFor(token?: string) {
    return createTRPCClient<AppRouter>({
      links: [
        httpLink({
          url,
          transformer: superjson,
          headers: () => (token ? { authorization: `Bearer ${token}` } : {}),
        }),
      ],
    });
  }

  const guest = clientFor();
  const campuses = await guest.campus.list.query();
  const campus = campuses[0]!;

  // A signed-in client, for the authenticated share of the mix.
  const auth = await guest.auth.devSignIn.mutate({
    userId: '00000000-0000-4000-8000-000000000001',
  });
  const member = clientFor(auth.token);

  // Ids to read, sampled from the active window the feed actually returns.
  const firstPage = await guest.listing.feed.query({ campusId: campus.id, limit: 50 });
  const listingIds = firstPage.items.map((i) => i.id);
  if (listingIds.length === 0) throw new Error('feed returned nothing — dataset is wrong');

  /* ------------------------------------------------- per-endpoint SQL cost */

  console.log('queries per request (single call, cold cache):');
  const sqlProbe: { name: string; run: () => Promise<unknown> }[] = [
    { name: 'listing.feed (20)', run: () => guest.listing.feed.query({ campusId: campus.id, limit: 20 }) },
    { name: 'listing.feed (search)', run: () => guest.listing.feed.query({ campusId: campus.id, q: 'jacket', limit: 20 }) },
    { name: 'listing.byId', run: () => guest.listing.byId.query({ id: listingIds[0]! }) },
    { name: 'campus.list', run: () => guest.campus.list.query() },
    { name: 'conversation.list', run: () => member.conversation.list.query() },
    { name: 'reservation.mine', run: () => member.reservation.mine.query() },
  ];

  const sqlCost = new Map<string, number>();
  for (const probe of sqlProbe) {
    sqlStats.enabled = true;
    sqlStats.reset();
    await probe.run();
    const n = sqlStats.count;
    const shapes = [...sqlStats.byStatement.entries()].sort((a, b) => b[1] - a[1]);
    sqlStats.enabled = false;
    sqlCost.set(probe.name, n);

    // Flag writes on a read path: they are what stops a read replica from
    // taking the load, and they take row locks that concurrent readers queue on.
    const writes = shapes
      .filter(([shape]) => /^(insert|update|delete)/i.test(shape.trim()))
      .reduce((sum, [, count]) => sum + count, 0);

    console.log(
      `  ${probe.name.padEnd(24)} ${String(n).padStart(4)} queries` +
        (writes > 0 ? `  (${writes} writes)` : ''),
    );
    // Any shape running more than twice in one request is an N+1 shape.
    for (const [shape, count] of shapes.filter(([, c]) => c > 2)) {
      console.log(`      x${count}  ${shape.slice(0, 84)}`);
    }
  }
  console.log('');

  /* -------------------------------------------------------- traffic mix */

  // Weighted to a browse-heavy marketplace session: look at the grid, open a
  // few items, occasionally search, rarely write.
  type Step = { name: string; weight: number; run: () => Promise<unknown> };
  let cursor: string | undefined;
  const steps: Step[] = [
    {
      name: 'feed',
      weight: 55,
      run: async () => {
        const page = await guest.listing.feed.query({ campusId: campus.id, limit: 20, cursor });
        // Walk pages like an infinite scroll, then wrap around.
        cursor = page.nextCursor ?? undefined;
        return page;
      },
    },
    {
      name: 'detail',
      weight: 22,
      run: () => guest.listing.byId.query({ id: listingIds[Math.floor(Math.random() * listingIds.length)]! }),
    },
    {
      name: 'search',
      weight: 9,
      run: () =>
        guest.listing.feed.query({
          campusId: campus.id,
          q: ['jacket', 'desk', 'shoes', 'lamp'][Math.floor(Math.random() * 4)],
          limit: 20,
        }),
    },
    {
      name: 'filter',
      weight: 6,
      run: () => guest.listing.feed.query({ campusId: campus.id, pickupToday: true, limit: 20 }),
    },
    { name: 'inbox', weight: 5, run: () => member.conversation.list.query() },
    { name: 'reservations', weight: 3, run: () => member.reservation.mine.query() },
  ];

  const totalWeight = steps.reduce((sum, s) => sum + s.weight, 0);
  function pickStep(): Step {
    let roll = Math.random() * totalWeight;
    for (const s of steps) {
      roll -= s.weight;
      if (roll <= 0) return s;
    }
    return steps[0]!;
  }

  const stats = new Map<string, Samples>(steps.map((s) => [s.name, new Samples()]));

  // Warm up so migrations, plan caches and JIT are not charged to the results.
  for (let i = 0; i < 40; i += 1) await pickStep().run();

  console.log(`driving ${CONCURRENCY} concurrent workers for ${SECONDS}s...\n`);
  const deadline = Date.now() + SECONDS * 1000;
  const runStarted = Date.now();

  async function worker(): Promise<void> {
    while (Date.now() < deadline) {
      const step = pickStep();
      const sample = stats.get(step.name)!;
      const started = performance.now();
      try {
        await step.run();
        sample.add(performance.now() - started);
      } catch {
        sample.errors += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const elapsed = (Date.now() - runStarted) / 1000;

  /* ----------------------------------------------------------- reporting */

  let totalRequests = 0;
  let totalErrors = 0;
  console.log('endpoint          requests      p50      p95      p99   errors');
  console.log('─'.repeat(66));
  for (const step of steps) {
    const s = stats.get(step.name)!;
    totalRequests += s.count;
    totalErrors += s.errors;
    console.log(
      `${step.name.padEnd(14)}${String(s.count).padStart(10)}` +
        `${fmt(s.percentile(50))}${fmt(s.percentile(95))}${fmt(s.percentile(99))}` +
        `${String(s.errors).padStart(9)}`,
    );
  }
  console.log('─'.repeat(66));

  const rps = totalRequests / elapsed;
  console.log(
    `\n${totalRequests.toLocaleString()} requests in ${elapsed.toFixed(1)}s = ` +
      `${rps.toFixed(0)} req/s   errors: ${totalErrors}`,
  );

  // 5,000 DAU at ~20 requests per session is ~100k requests/day. Traffic on a
  // campus is spiky, so assume a peak hour carrying 15% of the day and a 3x
  // burst inside it.
  const dailyRequests = 5000 * 20;
  const peakHourRps = (dailyRequests * 0.15) / 3600;
  const burstRps = peakHourRps * 3;
  console.log(
    `\n5,000 DAU works out to ~${dailyRequests.toLocaleString()} req/day, ` +
      `~${peakHourRps.toFixed(1)} req/s in the peak hour, ~${burstRps.toFixed(0)} req/s bursting.`,
  );
  console.log(
    rps >= burstRps
      ? `Headroom: ${(rps / burstRps).toFixed(1)}x over the burst estimate on ${dbKind}.`
      : `UNDER the burst estimate on ${dbKind} — ${rps.toFixed(0)} req/s vs ${burstRps.toFixed(0)} needed.`,
  );

  server.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  return totalErrors === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    process.exit(1);
  });
