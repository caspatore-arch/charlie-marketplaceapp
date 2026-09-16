/**
 * tRPC request context: the db handle plus the caller resolved from the
 * `Authorization: Bearer <token>` header. Tokens are never stored — only
 * their sha256 hash lives in `sessions`.
 */
import crypto from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';

import { db } from '../db/client';
import { sessions, users, type User } from '../db/schema';

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function newSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function userFromAuthHeader(header: string | null | undefined): Promise<User | null> {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;

  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(match[1]!)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  // A closed account's session (if it somehow still exists) resolves to
  // signed-out rather than a live user — deleteAccount also removes the
  // sessions themselves, but this is the defense-in-depth backstop.
  if (row?.user.deletedAt != null) return null;

  return row?.user ?? null;
}

export type Context = {
  db: typeof db;
  user: User | null;
};

/** Used by the Hono @hono/trpc-server adapter (fetch-style options). */
export async function createContext(opts: { req: Request }): Promise<Context> {
  return { db, user: await userFromAuthHeader(opts.req.headers.get('authorization')) };
}
