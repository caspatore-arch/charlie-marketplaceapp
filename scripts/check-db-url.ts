/**
 * Verifies the real-Postgres path: connects with DATABASE_URL, runs the
 * committed migrations against it, and prints the resulting table count.
 *
 * Run this after pointing DATABASE_URL at a hosted database (Neon, etc.) to
 * confirm the one-variable switch works before flipping the app over to it:
 *
 *   DATABASE_URL=postgres://user:pass@host/db npm run db:check
 *
 * This script never touches PGlite — it only exercises the node-postgres
 * driver path in backend/db/client.ts.
 */
async function main(): Promise<void> {
  const { env } = await import('../backend/env');
  if (!env.databaseUrl) {
    console.error(
      'DATABASE_URL is not set. Export it (or add it to .env) as a Postgres ' +
        'connection string and re-run `npm run db:check`.',
    );
    process.exit(1);
  }

  const { db, dbKind, pgPool } = await import('../backend/db/client');
  if (dbKind !== 'postgres') {
    console.error(`Expected dbKind "postgres" with DATABASE_URL set, got "${dbKind}".`);
    process.exit(1);
  }

  console.log(`Connecting to ${maskedUrl(env.databaseUrl)} ...`);

  const { runMigrations } = await import('../backend/db/migrate');
  await runMigrations();
  console.log('Migrations applied.');

  const { sql } = await import('drizzle-orm');
  const result = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
  );
  const rows = (result as unknown as { rows?: { table_name: string }[] }).rows ?? [];

  console.log(`Connected. ${rows.length} tables in the public schema:`);
  for (const r of rows) console.log(`  - ${r.table_name}`);

  await pgPool?.end();
  process.exit(0);
}

/** Never print credentials, even to a local terminal. */
function maskedUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    if (u.username) u.username = '***';
    return u.toString();
  } catch {
    return '(unparseable connection string)';
  }
}

main().catch((err) => {
  console.error('db:check failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
