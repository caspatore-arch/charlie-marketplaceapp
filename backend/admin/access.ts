/**
 * Posting access for the founder dashboard (backend/admin/routes.ts): find an
 * account and set its override (backend/auth/posting-access.ts).
 *
 * The only personal details returned are display name and sign-in email —
 * never a phone number, contact details or anything else from the row.
 */
import { and, desc, eq, ilike, isNull, ne, or } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db/client';
import { users } from '../db/schema';
import { POSTING_ACCESS_VALUES } from '../auth/posting-access';

const LIMIT = 20;

const accessRow = {
  id: users.id,
  displayName: users.displayName,
  email: users.email,
  campusEmailVerifiedAt: users.campusEmailVerifiedAt,
  postingAccess: users.postingAccess,
  postingAccessChangedAt: users.postingAccessChangedAt,
  isDemo: users.isDemo,
  createdAt: users.createdAt,
};

function toRow(r: { campusEmailVerifiedAt: Date | null } & Record<string, unknown>) {
  const { campusEmailVerifiedAt, ...rest } = r;
  return { ...rest, campusEmailVerified: campusEmailVerifiedAt != null };
}

export const searchQuery = z.object({ q: z.string().trim().max(100).default('') });

/**
 * Case-insensitive partial match on email or display name, closed accounts
 * skipped, at most 20. An empty query lists the accounts whose access was
 * changed from 'default', most recently changed first.
 */
export async function searchAccessUsers(q: string) {
  const open = isNull(users.deletedAt);
  let where;
  if (q) {
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where = and(open, or(ilike(users.email, pattern), ilike(users.displayName, pattern)));
  } else {
    where = and(open, ne(users.postingAccess, 'default'));
  }
  const rows = await db
    .select(accessRow)
    .from(users)
    .where(where)
    .orderBy(q ? desc(users.createdAt) : desc(users.postingAccessChangedAt))
    .limit(LIMIT);
  return rows.map(toRow);
}

export const setAccessInput = z.object({
  userId: z.uuid(),
  access: z.enum(POSTING_ACCESS_VALUES),
});

/** Returns the updated row, or null when there is no open account with that id. */
export async function setPostingAccess(input: z.infer<typeof setAccessInput>) {
  const [row] = await db
    .update(users)
    .set({ postingAccess: input.access, postingAccessChangedAt: new Date() })
    .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
    .returning(accessRow);
  return row ? toRow(row) : null;
}
