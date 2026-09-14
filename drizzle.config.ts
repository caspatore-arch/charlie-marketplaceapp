import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './backend/db/schema.ts',
  out: './backend/db/migrations',
});
