/**
 * Database client.
 *
 * Local dev / demo: PGlite (Postgres compiled to WASM) persisted on disk.
 * Production: set DATABASE_URL to swap in drizzle-orm/node-postgres against a
 * real Postgres (e.g. Neon) — the schema is identical Postgres SQL, so
 * nothing else changes. Verify a hosted URL with `npm run db:check`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as pgliteDrizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { drizzle as nodePgDrizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';

import { env } from '../env';
import * as schema from './schema';

export type Schema = typeof schema;
/**
 * Both `PgliteDatabase` and `NodePgDatabase` extend `PgDatabase<Kind, Schema>`
 * — using that common base (instead of a union of the two concrete classes)
 * avoids TypeScript collapsing overloaded query-builder methods (e.g.
 * `.returning()`) to their narrowest shared signature across the union.
 */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

/** Which driver is actually in use — reported by GET /api/health. */
export const dbKind: 'pglite' | 'postgres' = env.databaseUrl ? 'postgres' : 'pglite';

/** Set only when dbKind === 'postgres'; exported so tooling can close it cleanly. */
let pool: Pool | null = null;

/**
 * SSL is required for hosted providers (Neon, etc.) but off for a local/LAN
 * Postgres unless explicitly requested. `rejectUnauthorized: false` matches
 * what most managed Postgres providers need without a custom CA bundle.
 */
function sslOptionFor(databaseUrl: string): { rejectUnauthorized: boolean } | undefined {
  if (process.env.PGSSL === 'require') return { rejectUnauthorized: false };
  let host = '';
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    // Not a parseable URL (shouldn't happen for a real connection string) —
    // fall through to requiring SSL, the safer default.
  }
  const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  return isLocalhost ? undefined : { rejectUnauthorized: false };
}

function createDb(): Db {
  if (env.databaseUrl) {
    pool = new Pool({
      connectionString: env.databaseUrl,
      ssl: sslOptionFor(env.databaseUrl),
    });
    return nodePgDrizzle(pool, { schema });
  }

  // PGlite creates its own datadir but not the parents of it.
  fs.mkdirSync(path.dirname(path.resolve(env.pgliteDir)), { recursive: true });

  const client = new PGlite(env.pgliteDir);
  return pgliteDrizzle(client, { schema });
}

export const db: Db = createDb();

/** Underlying PGlite handle (used by tests to close the datadir cleanly). */
export const pglite: PGlite | null = env.databaseUrl
  ? null
  : ((db as PgliteDatabase<Schema> & { $client: PGlite }).$client);

/** Underlying pg Pool (used by tooling like scripts/check-db-url.ts to close cleanly). */
export const pgPool: Pool | null = pool;

export { schema };
