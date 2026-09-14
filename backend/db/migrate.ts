/**
 * Applies the committed SQL migrations in backend/db/migrations/.
 * Called once on server start and by the seed script.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { db, dbKind } from './client';

const here = path.dirname(fileURLToPath(import.meta.url));
export const migrationsFolder = path.join(here, 'migrations');

export async function runMigrations(): Promise<void> {
  if (dbKind !== 'pglite') {
    throw new Error('install pg to use DATABASE_URL');
  }
  await migrate(db, { migrationsFolder });
}
