/**
 * Address → coordinates for "custom meetup address" (docs/AUCTIONS.md §2).
 *
 * Uses OpenStreetMap **Nominatim** (https://nominatim.org/release-docs/latest/api/Search/)
 * with a descriptive User-Agent (Nominatim rejects anonymous/default-UA
 * traffic) and a read-through cache in the `geocode_cache` table so a
 * repeated address never re-hits the third party.
 *
 * IMPORTANT — production note: Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/)
 * forbids heavy/commercial use of the public instance. This is fine for a
 * pilot's low request volume, but **production needs a paid geocoder**
 * (e.g. Google Geocoding API, Mapbox, Radar) before any real traffic.
 * Also noted in docs/HANDOFF.md's "Simulated or unfinished" table.
 *
 * Because the network may be unavailable in this environment (CI, sandboxed
 * dev), set `GEOCODER=stub` to use a small deterministic offline fixture
 * instead — `npm run test:e2e` and `scripts/geo-check.ts` both rely on this
 * so they never depend on a third-party service being reachable.
 */
import { eq } from 'drizzle-orm';

import type { Db } from './db/client';
import { geocodeCache } from './db/schema';

export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
}

/** Thrown for the three distinct, human-readable failure modes. */
export class GeocodeError extends Error {
  constructor(
    message: string,
    public readonly kind: 'not_found' | 'network' | 'timeout',
  ) {
    super(message);
    this.name = 'GeocodeError';
  }
}

const USER_AGENT = 'Dibbs/1.0 (student campus marketplace prototype; contact: founder@dibbs.example)';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const TIMEOUT_MS = 4_000;

function normalizeQuery(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Deterministic offline fixture for `GEOCODER=stub`. A handful of fixed
 * Tucson addresses so tests never depend on network access. Anything not in
 * this list is treated as unresolvable, matching real geocoder behavior for
 * a bad address.
 */
const STUB_FIXTURES: Record<string, GeocodeResult> = {
  // ~0.3mi from campus center (32.2319, -110.9501) — well inside the radius.
  '900 e university blvd, tucson, az': {
    lat: 32.2325,
    lng: -110.9497,
    displayName: '900 E University Blvd, Tucson, AZ 85719',
  },
  // Right at campus center.
  '1200 e university blvd, tucson, az': {
    lat: 32.2319,
    lng: -110.9501,
    displayName: '1200 E University Blvd, Tucson, AZ 85721',
  },
  // ~6mi away — well outside the 2-mile radius.
  '4455 e speedway blvd, tucson, az': {
    lat: 32.2359,
    lng: -110.8626,
    displayName: '4455 E Speedway Blvd, Tucson, AZ 85712',
  },
};

async function geocodeStub(address: string): Promise<GeocodeResult> {
  const hit = STUB_FIXTURES[normalizeQuery(address)];
  if (!hit) {
    throw new GeocodeError("We couldn't find that address.", 'not_found');
  }
  return hit;
}

async function geocodeViaNominatim(address: string): Promise<GeocodeResult> {
  const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(address)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new GeocodeError('That took too long to look up. Try again.', 'timeout');
    }
    throw new GeocodeError(
      "We couldn't reach the address lookup service. Check your connection and try again.",
      'network',
    );
  }

  if (!res.ok) {
    throw new GeocodeError(
      "We couldn't reach the address lookup service. Check your connection and try again.",
      'network',
    );
  }

  const body = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  const first = body[0];
  if (!first) {
    throw new GeocodeError("We couldn't find that address.", 'not_found');
  }

  return { lat: Number(first.lat), lng: Number(first.lon), displayName: first.display_name };
}

/**
 * Resolves a free-text address to coordinates, using the `geocode_cache`
 * table as a read-through cache. Throws `GeocodeError` on no result, network
 * failure, or timeout — each with a distinct `kind` and a human message.
 */
export async function geocodeAddress(db: Db, address: string): Promise<GeocodeResult> {
  const trimmed = address.trim();
  if (trimmed.length === 0) {
    throw new GeocodeError("We couldn't find that address.", 'not_found');
  }
  const cacheKey = normalizeQuery(trimmed);

  const [cached] = await db
    .select()
    .from(geocodeCache)
    .where(eq(geocodeCache.query, cacheKey))
    .limit(1);
  if (cached) {
    return { lat: cached.lat, lng: cached.lng, displayName: cached.displayName };
  }

  const result =
    process.env.GEOCODER === 'stub' ? await geocodeStub(trimmed) : await geocodeViaNominatim(trimmed);

  // Best-effort cache write — a race with another request writing the same
  // key is fine, whichever lands last wins; not worth a transaction.
  await db
    .insert(geocodeCache)
    .values({ query: cacheKey, lat: result.lat, lng: result.lng, displayName: result.displayName })
    .onConflictDoUpdate({
      target: geocodeCache.query,
      set: { lat: result.lat, lng: result.lng, displayName: result.displayName, fetchedAt: new Date() },
    });

  return result;
}

const EARTH_RADIUS_METERS = 6_371_000;

/** Great-circle distance between two lat/lng points, in meters. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/** Google Maps directions URL for a raw lat/lng pair (custom addresses have no spot row). */
export function directionsUrlForCoords(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
