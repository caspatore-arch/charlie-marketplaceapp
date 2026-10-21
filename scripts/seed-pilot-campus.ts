/**
 * Adds the real pilot campus (University of Arizona) and its meetup spots to
 * whatever database DATABASE_URL points at. Nothing else: no demo users, no
 * demo listings, no photos. Safe to run more than once (existing rows are left
 * as they are).
 *
 *   DATABASE_URL='postgresql://...' npm run db:seed-campus
 *
 * Uses the same ids as backend/db/seed.ts, so running the demo seed later
 * against the same database does not create a second campus.
 */
async function main(): Promise<void> {
  const { env } = await import('../backend/env');
  const { db, dbKind, pgPool } = await import('../backend/db/client');
  const { runMigrations } = await import('../backend/db/migrate');
  const { campuses, meetupSpots } = await import('../backend/db/schema');

  if (!env.databaseUrl) {
    console.log('DATABASE_URL is not set, so this will write to the local database.');
  }
  console.log(`Database: ${dbKind}`);

  await runMigrations();

  const CAMPUS_ID = '00000000-0000-4000-8000-0000000000aa';

  const campusRows = await db
    .insert(campuses)
    .values({
      id: CAMPUS_ID,
      name: 'University of Arizona',
      slug: 'arizona',
      emailDomains: ['arizona.edu'],
      timezone: 'America/Phoenix',
      isDemo: false,
    })
    .onConflictDoNothing()
    .returning({ id: campuses.id });

  const spotRows = await db
    .insert(meetupSpots)
    .values([
      {
        id: '00000000-0000-4000-8000-000000000011',
        campusId: CAMPUS_ID,
        name: 'Student Union Memorial Center',
        description: 'Main entrance, under the awning by the north doors',
        lat: 32.232,
        lng: -110.9505,
      },
      {
        id: '00000000-0000-4000-8000-000000000012',
        campusId: CAMPUS_ID,
        name: 'Main Library',
        description: 'Front steps, to the right of the entrance doors',
        lat: 32.2296,
        lng: -110.952,
      },
      {
        id: '00000000-0000-4000-8000-000000000013',
        campusId: CAMPUS_ID,
        name: 'Old Main',
        description: 'Front lawn, by the fountain on the walkway side',
        lat: 32.2318,
        lng: -110.954,
      },
      {
        id: '00000000-0000-4000-8000-000000000014',
        campusId: CAMPUS_ID,
        name: 'Student Recreation Center',
        description: 'Entrance, by the bike racks outside the front desk',
        lat: 32.234,
        lng: -110.947,
      },
    ])
    .onConflictDoNothing()
    .returning({ id: meetupSpots.id });

  console.log(
    `Campus: ${campusRows.length ? 'added' : 'already there'}. ` +
      `Meetup spots added: ${spotRows.length} (others already there).`,
  );

  await pgPool?.end();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
