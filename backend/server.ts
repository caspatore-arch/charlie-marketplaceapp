/** Local entry point: migrate, then serve the Hono app. */
import os from 'node:os';
import { serve } from '@hono/node-server';

import { runMigrations } from './db/migrate';
import { db, dbKind } from './db/client';
import { resolveSmsMode } from './sms/provider';
import { startSmsDispatcher } from './sms/outbox';
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
  startSmsDispatcher(db);

  const port = env.port;
  serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
    const lan = lanAddress();
    console.log(`dibbs backend (${dbKind}) listening on http://localhost:${port}`);
    console.log(`  health: http://localhost:${port}/api/health`);
    const sms = resolveSmsMode();
    console.log(`  sms: ${sms.mode} (${sms.reason})`);
    if (lan) {
      console.log(`  on your phone, set EXPO_PUBLIC_RORK_API_BASE_URL=http://${lan}:${port}`);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
