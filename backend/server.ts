/** Local entry point: migrate, then serve the Hono app. */
import os from 'node:os';
import { serve } from '@hono/node-server';

import { runMigrations } from './db/migrate';
import { dbKind } from './db/client';
import { env } from './env';
import app from './hono';

function lanAddress(): string | null {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}

async function main() {
  await runMigrations();

  const port = env.port;
  serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
    const lan = lanAddress();
    console.log(`campus-swap backend (${dbKind}) listening on http://localhost:${port}`);
    console.log(`  health: http://localhost:${port}/api/health`);
    if (lan) {
      console.log(`  on your phone, set EXPO_PUBLIC_RORK_API_BASE_URL=http://${lan}:${port}`);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
