/**
 * Applies the committed SQL migrations in backend/db/migrations/.
 * Called once on server start and by the seed script. Works against either
 * driver — PGlite locally, node-postgres when DATABASE_URL is set.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { db, dbKind, type Schema } from './client';

const here = path.dirname(fileURLToPath(import.meta.url));
export const migrationsFolder = path.join(here, 'migrations');

export async function runMigrations(): Promise<void> {
  if (dbKind === 'postgres') {
    await migratePg(db as NodePgDatabase<Schema>, { migrationsFolder });
  } else {
    await migratePglite(db as PgliteDatabase<Schema>, { migrationsFolder });
  }
}
