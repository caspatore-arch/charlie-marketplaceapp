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

/**
 * Opt-in SQL counter, enabled with SQL_TRACE=1. Off by default and costing
 * nothing when off. scripts/loadtest.ts uses it to report queries per request,
 * which is the number that predicts how an endpoint behaves under load far
 * better than a single-user latency reading does.
 */
export const sqlStats = {
  /**
   * Installed when SQL_TRACE=1, but counting is toggled at call time so a
   * harness can measure a few probe requests without charging the cost to a
   * throughput run.
   */
  enabled: false,
  count: 0,
  /** Per-normalised-statement counts, for spotting N+1 patterns. */
  byStatement: new Map<string, number>(),
  reset() {
    this.count = 0;
    this.byStatement.clear();
  },
};

const tracingLogger = {
  logQuery(query: string): void {
    if (!sqlStats.enabled) return;
    sqlStats.count += 1;
    // Collapse literals and parameter markers so repeated shapes group together.
    const shape = query.replace(/\$\d+/g, '?').replace(/\s+/g, ' ').slice(0, 120);
    sqlStats.byStatement.set(shape, (sqlStats.byStatement.get(shape) ?? 0) + 1);
  },
};

function createDb(): Db {
  const logger = process.env.SQL_TRACE === '1' ? tracingLogger : undefined;

  if (env.databaseUrl) {
    pool = new Pool({
      connectionString: env.databaseUrl,
      ssl: sslOptionFor(env.databaseUrl),
      max: env.dbPoolMax,
      // node-postgres defaults this to 0 — wait forever for a free connection.
      // Under a burst that converts a slow database into an unresponsive app,
      // because every request queues instead of failing. See env.ts.
      connectionTimeoutMillis: env.dbConnectionTimeoutMs,
      idleTimeoutMillis: 30_000,
      // Enforced by Postgres itself, so it still applies to a query whose
      // client has already gone away.
      statement_timeout: env.dbStatementTimeoutMs,
      // Names the connections in pg_stat_activity, which is the first place
      // anyone looks when the database is the suspect.
      application_name: 'dibbs',
    });

    // An idle client that errors (a database restart, a failover, an idle
    // connection reaped by the provider) emits on the pool. node-postgres
    // treats an unhandled 'error' here as an unhandled exception and takes the
    // process down, so a routine provider maintenance window would otherwise
    // read as a crash. The pool discards the bad client and reconnects on its
    // own; logging is the correct response.
    pool.on('error', (err) => {
      console.error('[db] idle client error (pool will reconnect):', err.message);
    });

    return nodePgDrizzle(pool, { schema, logger });
  }

  // PGlite creates its own datadir but not the parents of it.
  fs.mkdirSync(path.dirname(path.resolve(env.pgliteDir)), { recursive: true });

  const client = new PGlite(env.pgliteDir);
  return pgliteDrizzle(client, { schema, logger });
}

export const db: Db = createDb();

/** Underlying PGlite handle (used by tests to close the datadir cleanly). */
export const pglite: PGlite | null = env.databaseUrl
  ? null
  : ((db as PgliteDatabase<Schema> & { $client: PGlite }).$client);

/** Underlying pg Pool (used by tooling like scripts/check-db-url.ts to close cleanly). */
export const pgPool: Pool | null = pool;

export { schema };
