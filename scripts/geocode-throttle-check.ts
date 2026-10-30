/**
 * Focused proof that `backend/geocode.ts` throttles requests to the public
 * Nominatim instance to at most 1 request/second, per its usage policy
 * (https://operations.osmfoundation.org/policies/nominatim/, also documented
 * in docs/AUCTIONS.md §2 and the file header).
 *
 *   npx tsx scripts/geocode-throttle-check.ts
 *
 * Mocks `fetch` so this never touches the real Nominatim service or a
 * database — it only exercises the throttle and error paths in
 * `geocodeViaNominatim`. Takes ~2s to run (two enforced ~1s waits).
 */

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];

async function criterion(name: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail });
    console.log(`FAIL  ${name}\n      ${detail}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function mockFetch(callTimes: number[], body: unknown): typeof fetch {
  return (async () => {
    callTimes.push(Date.now());
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

async function main(): Promise<number> {
  const { geocodeViaNominatim, GeocodeError } = await import('../backend/geocode');

  const callTimes: number[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch(callTimes, [{ lat: '32.2319', lon: '-110.9501', display_name: 'Mock Address' }]);

  try {
    await criterion('1. The first lookup is not delayed by the throttle', async () => {
      const start = Date.now();
      const result = await geocodeViaNominatim('100 Mock St');
      assert(callTimes.length === 1, `expected exactly 1 fetch call so far, got ${callTimes.length}`);
      assert(
        callTimes[0]! - start < 200,
        `the first request should fire immediately, waited ${callTimes[0]! - start}ms`,
      );
      assert(result.lat === 32.2319 && result.lng === -110.9501, 'should resolve the mocked coordinates');
    });

    await criterion('2. Concurrent lookups are serialized to <= 1 request/second', async () => {
      await Promise.all([geocodeViaNominatim('200 Mock St'), geocodeViaNominatim('300 Mock St')]);
      assert(callTimes.length === 3, `expected 3 total fetch calls, got ${callTimes.length}`);
      const gap1 = callTimes[1]! - callTimes[0]!;
      const gap2 = callTimes[2]! - callTimes[1]!;
      assert(gap1 >= 950, `gap between request 1 and 2 was only ${gap1}ms, want >= ~1000ms`);
      assert(gap2 >= 950, `gap between request 2 and 3 was only ${gap2}ms, want >= ~1000ms`);
    });

    await criterion('3. A no-result response still raises not_found, not a throttle error', async () => {
      globalThis.fetch = mockFetch(callTimes, []);
      let threw: unknown;
      try {
        await geocodeViaNominatim('An address nowhere');
      } catch (err) {
        threw = err;
      }
      assert(threw instanceof GeocodeError, `expected a GeocodeError, got ${String(threw)}`);
      assert(
        (threw as InstanceType<typeof GeocodeError>).kind === 'not_found',
        `expected kind 'not_found', got ${(threw as InstanceType<typeof GeocodeError>).kind}`,
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    console.log('Failures:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
  return failed.length > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
