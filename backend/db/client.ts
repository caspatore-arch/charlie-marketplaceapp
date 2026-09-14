/**
 * Database client.
 *
 * Local dev / demo: PGlite (Postgres compiled to WASM) persisted on disk.
 * Production: set DATABASE_URL and swap in drizzle-orm/node-postgres —
 * the schema is identical Postgres SQL, so nothing else changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';

import { env } from '../env';
import * as schema from './schema';

export type Schema = typeof schema;
export type Db = PgliteDatabase<Schema>;

/** Which driver is actually in use — reported by GET /api/health. */
export const dbKind: 'pglite' | 'postgres' = env.databaseUrl ? 'postgres' : 'pglite';

function createDb(): Db {
  if (env.databaseUrl) {
    // Intentional stub: `pg` is not a dependency of this prototype. To run
    // against a real Postgres, `npm i pg @types/pg` and replace this block with:
    //
    //   const { drizzle: pgDrizzle } = await import('drizzle-orm/node-postgres');
    //   return pgDrizzle(env.databaseUrl, { schema });
    //
    throw new Error('install pg to use DATABASE_URL');
  }

  // PGlite creates its own datadir but not the parents of it.
  fs.mkdirSync(path.dirname(path.resolve(env.pgliteDir)), { recursive: true });

  const client = new PGlite(env.pgliteDir);
  return drizzle(client, { schema });
}

export const db: Db = createDb();

/** Underlying PGlite handle (used by tests to close the datadir cleanly). */
export const pglite: PGlite | null = env.databaseUrl
  ? null
  : ((db as Db & { $client: PGlite }).$client);

export { schema };
