// Creates accounts directly in the end-to-end database. There is no setup flow to do it
// through until WI-016. Uses its own connection: the test process has no app environment.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { positionsBetween } from "@/lib/position";
import { hashPassword } from "@/server/auth/password";
import * as schema from "@/server/db/schema";

import { E2E_DATABASE_URL } from "./environment";

export async function seedAccount(input: {
  email: string;
  password: string;
  role: "admin" | "manager" | "member" | "viewer";
  /** Defaults to "E2E User". */
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
 * Adds `count` tasks to a project directly in the database, spread evenly over its columns
 * in board order, numbered after its existing tasks and reported by `reporterEmail`
 * (WS-037 section 8: a large board). Returns the keys of the last task of each column.
 */
export async function seedTasks(input: {
  projectKey: string;
  count: number;
  reporterEmail: string;
}): Promise<string[]> {
  const client = postgres(E2E_DATABASE_URL, { onnotice: () => undefined, max: 1 });
  try {
    return await client.begin(async (sql) => {
      const [project] = await sql<{ id: string; next: number }[]>`
        select id, next_task_number as next from projects where key = ${input.projectKey}
        for update`;
      const [reporter] = await sql<{ id: string }[]>`
        select id from accounts where email = ${input.reporterEmail}`;
      if (!project || !reporter) throw new Error("no such project or reporter");
      const columns = await sql<{ id: string }[]>`
        select id from columns where project_id = ${project.id} order by position`;
      const perColumn = Math.ceil(input.count / columns.length);
      const last: string[] = [];
      let number = project.next;
      let left = input.count;
      for (const column of columns) {
        const take = Math.min(perColumn, left);
        if (take === 0) break;
        const [max] = await sql<{ position: string | null }[]>`
          select max(position) as position from tasks where column_id = ${column.id}`;
        const rows = positionsBetween(max?.position ?? null, null, take).map((position) => {
          const row = {
            project_id: project.id,
            number,
            title: `Seeded task ${String(number)}`,
            column_id: column.id,
            position,
            reporter_account_id: reporter.id,
          };
          number += 1;
          return row;
        });
        await sql`insert into tasks ${sql(rows)}`;
        last.push(`${input.projectKey}-${String(number - 1)}`);
        left -= take;
      }
      await sql`update projects set next_task_number = ${number} where id = ${project.id}`;
      return last;
    });
  } finally {
    await client.end();
  }
}
