// Creates accounts directly in the end-to-end database. There is no setup flow to do it
// through until WI-016. Uses its own connection: the test process has no app environment.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { positionsBetween } from "@/lib/position";
import { generateApiToken } from "@/server/auth/api-token";
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

/**
 * Creates a QA agent directly in the end-to-end database, with the rows `createTestAgent`
 * writes (WS-074): all projects and the `qa_agent` scopes. Returns its id.
 */
export async function seedAgent(name: string): Promise<string> {
  const client = postgres(E2E_DATABASE_URL, { onnotice: () => undefined, max: 1 });
  try {
    const db = drizzle({ client, schema });
    const [agent] = await db
      .insert(schema.accounts)
      .values({ kind: "agent", name, role: "qa_agent", allProjects: true })
      .returning();
    if (!agent) throw new Error("agent not created");
    await db
      .insert(schema.agentScopes)
      .values(
        (["projects:read", "tasks:read", "reports:write", "comments:write"] as const).map(
          (scope) => ({ accountId: agent.id, scope }),
        ),
      );
    return agent.id;
  } finally {
    await client.end();
  }
}

/**
 * Inserts one task reported by an agent, at the end of the project's first column, and one
 * `user` comment by the same agent on it (WS-074). Returns the task's key.
 */
export async function seedAgentWork(input: {
  agentId: string;
  projectKey: string;
  title: string;
  comment: string;
}): Promise<string> {
  const client = postgres(E2E_DATABASE_URL, { onnotice: () => undefined, max: 1 });
  try {
    return await client.begin(async (sql) => {
      const [project] = await sql<{ id: string; next: number }[]>`
        select id, next_task_number as next from projects where key = ${input.projectKey}
        for update`;
      if (!project) throw new Error("no such project");
      const [column] = await sql<{ id: string }[]>`
        select id from columns where project_id = ${project.id} order by position limit 1`;
      if (!column) throw new Error("no column");
      const [max] = await sql<{ position: string | null }[]>`
        select max(position) as position from tasks where column_id = ${column.id}`;
      const [position] = positionsBetween(max?.position ?? null, null, 1);
      const [task] = await sql<{ id: string }[]>`
        insert into tasks (project_id, number, title, column_id, position, reporter_account_id)
        values (${project.id}, ${project.next}, ${input.title}, ${column.id}, ${position ?? ""},
          ${input.agentId})
        returning id`;
      if (!task) throw new Error("task not created");
      await sql`
        insert into comments (task_id, kind, author_account_id, body)
        values (${task.id}, 'user', ${input.agentId}, ${input.comment})`;
      await sql`update projects set next_task_number = ${project.next + 1} where id = ${project.id}`;
      return `${input.projectKey}-${String(project.next)}`;
    });
  } finally {
    await client.end();
  }
}

/**
 * Creates an API token for an agent from `seedAgent`, with the row `createApiToken` writes
 * (WS-072), and returns the token, so a test files bug reports through the real API
 * (WS-091).
 */
export async function seedAgentToken(agentId: string): Promise<string> {
  const client = postgres(E2E_DATABASE_URL, { onnotice: () => undefined, max: 1 });
  try {
    const db = drizzle({ client, schema });
    const generated = generateApiToken();
    await db.insert(schema.apiTokens).values({
      accountId: agentId,
      publicId: generated.publicId,
      secretHash: generated.secretHash,
      name: "E2E",
    });
    return generated.token;
  } finally {
    await client.end();
  }
}

/** One `field_changed` entry of a task's history, as `taskHistory` reads it. */
export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  actorEmail: string | null;
}

/**
 * A task's `field_changed` history entries, oldest first. No endpoint reads a task's
 * history before WT-08's timeline, so the test reads the table (WS-110 question 5).
 */
export async function taskHistory(taskId: string): Promise<FieldChange[]> {
  const client = postgres(E2E_DATABASE_URL, { onnotice: () => undefined, max: 1 });
  try {
    const rows = await client<
      { field: string; old_value: unknown; new_value: unknown; email: string | null }[]
    >`
      select e.field, e.old_value, e.new_value, a.email
      from task_events e left join accounts a on a.id = e.actor_account_id
      where e.task_id = ${taskId} and e.type = 'field_changed'
      order by e.id`;
    return rows.map((row) => ({
      field: row.field,
      oldValue: row.old_value,
      newValue: row.new_value,
      actorEmail: row.email,
    }));
  } finally {
    await client.end();
  }
}

/**
 * A task's `field_changed` history entries with the acting account's id, oldest first, for
 * an agent's change: agents have no email for `taskHistory` to name (WS-115).
 */
export async function taskHistoryActors(
  taskId: string,
): Promise<{ field: string; newValue: unknown; actorId: string | null }[]> {
  const client = postgres(E2E_DATABASE_URL, { onnotice: () => undefined, max: 1 });
  try {
    const rows = await client<{ field: string; new_value: unknown; actor: string | null }[]>`
      select field, new_value, actor_account_id as actor
      from task_events
      where task_id = ${taskId} and type = 'field_changed'
      order by id`;
    return rows.map((row) => ({ field: row.field, newValue: row.new_value, actorId: row.actor }));
  } finally {
    await client.end();
  }
}
