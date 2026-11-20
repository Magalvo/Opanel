import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getEnv } from "@/server/env";

import { getDb } from "./client";
import { RUNTIME_TEST_ROLE, runtimeTestUrl } from "./testing";

/**
 * The runtime role's rights (WS-063, doc 0006 section 5), checked through a connection as a
 * login member of `opanel_app`, the way the app connects.
 */
let app: postgres.Sql;

beforeAll(() => {
  app = postgres(runtimeTestUrl(getEnv().DATABASE_URL), { onnotice: () => undefined, max: 1 });
});

afterAll(async () => {
  await app.end();
});

async function codeOf(statement: Promise<unknown>): Promise<string | undefined> {
  try {
    await statement;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("the runtime role is refused what the app must never do", () => {
  it.each([
    ["TRUNCATE", "truncate table audit_log"],
    ["ALTER TABLE", "alter table accounts add column smuggled integer"],
    ["CREATE TABLE", "create table smuggled (id integer)"],
    ["DROP TRIGGER", "drop trigger audit_log_append_only on audit_log"],
    ["UPDATE audit_log", "update audit_log set action = action"],
    ["DELETE audit_log", "delete from audit_log"],
    ["UPDATE task_events", "update task_events set type = type"],
    ["DELETE task_events", "delete from task_events"],
    ["UPDATE comments", "update comments set body = body"],
    ["DELETE comments", "delete from comments"],
  ])("%s answers insufficient_privilege", async (_name, statement) => {
    expect(await codeOf(app.unsafe(statement))).toBe("42501");
  });
});

describe("the runtime role can do what the app does", () => {
  it("connects as a member of opanel_app", async () => {
    const [row] =
      await app`select current_user as name, pg_has_role(current_user, 'opanel_app', 'member') as member`;
    expect(row).toEqual({ name: RUNTIME_TEST_ROLE, member: true });
  });

  it("reads, writes, and appends to the audit log", async () => {
    const [account] = await app<{ id: string }[]>`
      insert into accounts (kind, name, email, role)
      values ('human', 'Runtime', 'runtime@example.com', 'member') returning id`;
    if (!account) throw new Error("no account inserted");
    const id = account.id;
    await app`update accounts set name = 'Runtime, renamed' where id = ${id}`;
    await app`insert into audit_log (action, entity) values ('test.runtime_role', 'account')`;
    const read = await app<{ name: string }[]>`select name from accounts where id = ${id}`;
    await app`delete from accounts where id = ${id}`;

    expect(read.map((row) => row.name)).toEqual(["Runtime, renamed"]);
  });
});

describe("the runtime role reads the migrations' table, and only reads it (WS-064)", () => {
  it("reads the latest applied migration", async () => {
    const rows = await app<{ latest: string | null }[]>`
      select max(created_at)::text as latest from drizzle.__drizzle_migrations`;
    expect(rows[0]?.latest).not.toBeNull();
  });

  it("cannot add to it", async () => {
    expect(
      await codeOf(app.unsafe("insert into drizzle.__drizzle_migrations (hash) values ('x')")),
    ).toBe("42501");
  });
});

describe("every table carries the runtime role's rights (WS-063 section 2)", () => {
  it("gives every table its rights, and append-only tables no UPDATE or DELETE", async () => {
    const rows = await getDb().$client<
      {
        table: string;
        appendOnly: boolean;
        select: boolean;
        insert: boolean;
        update: boolean;
        delete: boolean;
        truncate: boolean;
      }[]
    >`
      select t.tablename as table,
        exists (
          select 1 from pg_trigger g
          where g.tgrelid = (quote_ident(t.tablename))::regclass and g.tgname like '%append_only'
        ) as "appendOnly",
        has_table_privilege('opanel_app', quote_ident(t.tablename), 'SELECT') as select,
        has_table_privilege('opanel_app', quote_ident(t.tablename), 'INSERT') as insert,
        has_table_privilege('opanel_app', quote_ident(t.tablename), 'UPDATE') as update,
        has_table_privilege('opanel_app', quote_ident(t.tablename), 'DELETE') as delete,
        has_table_privilege('opanel_app', quote_ident(t.tablename), 'TRUNCATE') as truncate
      from pg_tables t where t.schemaname = 'public'
      order by t.tablename`;

    expect(rows.length).toBeGreaterThan(10);
    const wrong = rows.filter(
      (row) =>
        !row.select ||
        !row.insert ||
        row.truncate ||
        row.update === row.appendOnly ||
        row.delete === row.appendOnly,
    );
    expect(wrong).toEqual([]);
    expect(rows.filter((row) => row.appendOnly).map((row) => row.table)).toEqual([
      "audit_log",
      "bug_reports",
      "comments",
      "task_events",
    ]);
  });
});
