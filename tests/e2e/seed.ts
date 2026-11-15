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
  name?: string;
}): Promise<void> {
  const client = postgres(E2E_DATABASE_URL, { onnotice: () => undefined, max: 1 });
  try {
    const db = drizzle({ client, schema });
    const [account] = await db
      .insert(schema.accounts)
      .values({
        kind: "human",
        name: input.name ?? "E2E User",
        email: input.email,
        role: input.role,
      })
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

/**
 * Adds `count` tasks to the first column of a project, straight in the database, so a test
 * can load a big board without a thousand requests. Positions are valid ordering keys.
 */
export async function seedTasks(projectKey: string, count: number): Promise<void> {
  const client = postgres(E2E_DATABASE_URL, { onnotice: () => undefined, max: 1 });
  try {
    const [project] = await client<{ id: string; next: number }[]>`
      select id, next_task_number as next from projects where key = ${projectKey}`;
    if (!project) throw new Error("no such project");
    await client`
      insert into tasks (project_id, number, title, column_id, position, reporter_account_id)
      select ${project.id}::uuid, n, 'Seeded task ' || n,
        (select id from columns where project_id = ${project.id}::uuid order by position limit 1),
        'c' || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', (n / 3844) % 62 + 1, 1)
            || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', (n / 62) % 62 + 1, 1)
            || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', n % 62 + 1, 1),
        (select id from accounts order by created_at limit 1)
      from generate_series(${project.next}::int, ${project.next + count - 1}::int) n`;
    await client`update projects set next_task_number = ${project.next + count} where id = ${project.id}::uuid`;
  } finally {
    await client.end();
  }
}
