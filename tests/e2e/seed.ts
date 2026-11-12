// Creates accounts directly in the end-to-end database. There is no setup flow to do it
// through until WI-016. Uses its own connection: the test process has no app environment.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { hashPassword } from "@/server/auth/password";
import * as schema from "@/server/db/schema";

import { E2E_DATABASE_URL } from "./environment";

export async function seedAccount(input: {
  email: string;
  password: string;
  role: "admin" | "manager" | "member" | "viewer";
}): Promise<void> {
  const client = postgres(E2E_DATABASE_URL, { onnotice: () => undefined, max: 1 });
  try {
    const db = drizzle({ client, schema });
    const [account] = await db
      .insert(schema.accounts)
      .values({ kind: "human", name: "E2E User", email: input.email, role: input.role })
      .returning();
    if (!account) throw new Error("account not created");
    await db.insert(schema.credentials).values({
      accountId: account.id,
      providerId: "credential",
      providerAccountId: account.id,
      passwordHash: await hashPassword(input.password),
    });
  } finally {
    await client.end();
  }
}

/** Pretends an account's sessions were created `days` days ago (their expiry moves closer). */
export async function ageSessions(email: string, days: number): Promise<void> {
  const client = postgres(E2E_DATABASE_URL, { onnotice: () => undefined, max: 1 });
  try {
    await client`
      update sessions set expires_at = expires_at - make_interval(days => ${days})
      where account_id = (select id from accounts where email = ${email})`;
  } finally {
    await client.end();
  }
}

/** When the account's latest session expires. */
export async function sessionExpiry(email: string): Promise<Date> {
  const client = postgres(E2E_DATABASE_URL, { onnotice: () => undefined, max: 1 });
  try {
    const [row] = await client<{ expires_at: Date }[]>`
      select max(expires_at) as expires_at from sessions
      where account_id = (select id from accounts where email = ${email})`;
    if (!row) throw new Error("no session");
    return row.expires_at;
  } finally {
    await client.end();
  }
}
