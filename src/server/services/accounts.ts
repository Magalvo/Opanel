import { eq } from "drizzle-orm";

import type { Database } from "@/server/db/client";
import { accounts } from "@/server/db/schema";

export type AccountRow = typeof accounts.$inferSelect;

/** The only code that reads accounts for authentication. Emails are matched in lower case. */
export async function findAccountByEmail(
  db: Pick<Database, "select">,
  email: string,
): Promise<AccountRow | undefined> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.email, email.trim().toLowerCase()))
    .limit(1);
  return row;
}

export async function findAccountById(
  db: Pick<Database, "select">,
  id: string,
): Promise<AccountRow | undefined> {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  return row;
}

export async function touchLastSeen(db: Pick<Database, "update">, id: string): Promise<void> {
  await db.update(accounts).set({ lastSeenAt: new Date() }).where(eq(accounts.id, id));
}
