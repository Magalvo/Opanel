import { randomBytes } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createTestAccount, testActor } from "@/server/auth/testing";
import { getEnv } from "@/server/env";
import { createProject } from "@/server/services/projects";
import { createTask } from "@/server/services/tasks";

import { getDb } from "./client";
import * as schema from "./schema";
import {
  dropTestDatabase,
  dropWorkerDatabases,
  ensureRuntimeTestRole,
  ensureTestDatabase,
  ensureWorkerDatabase,
  resetDatabase,
} from "./testing";

/** Creating and dropping test databases on demand (WS-095), against the real server. */

function urlOf(name: string): string {
  const url = new URL(getEnv().DATABASE_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

const maintenance = postgres(urlOf("postgres"), { onnotice: () => undefined, max: 1 });

afterAll(async () => {
  await maintenance.end();
});

async function exists(name: string): Promise<boolean> {
  const rows = await maintenance`select 1 from pg_database where datname = ${name}`;
  return rows.length > 0;
}

function freshName(): string {
  return `opanel_ws095_${randomBytes(4).toString("hex")}_test`;
}

// Creating a database copies a template and waits for a checkpoint: seconds on a busy machine.
describe("ensureTestDatabase and dropTestDatabase", { timeout: 60_000 }, () => {
  it("creates a missing test database, once, and drops it", async () => {
    const name = freshName();
    expect(await exists(name)).toBe(false);

    await ensureTestDatabase(urlOf(name));
    expect(await exists(name)).toBe(true);
    await ensureTestDatabase(urlOf(name));

    expect(await dropTestDatabase(urlOf(name))).toBe("dropped");
    expect(await exists(name)).toBe(false);
    expect(await dropTestDatabase(urlOf(name))).toBe("missing");
  });

  it("creates it once when several processes ask at the same time", async () => {
    const name = freshName();
    await Promise.all([1, 2, 3, 4].map(() => ensureTestDatabase(urlOf(name))));
    expect(await exists(name)).toBe(true);
    await dropTestDatabase(urlOf(name));
  });

  it("refuses a database whose name does not end in _test", async () => {
    await expect(ensureTestDatabase(urlOf("opanel"))).rejects.toThrow(/must end in "_test"/);
    await expect(dropTestDatabase(urlOf("opanel"))).rejects.toThrow(/must end in "_test"/);
    expect(await exists("opanel")).toBe(true);
  });
});

describe("ensureRuntimeTestRole", () => {
  it("creates the role once when several setups ask at the same time", async () => {
    const role = `opanel_ws095_${randomBytes(4).toString("hex")}`;
    const connections = [1, 2, 3, 4].map(() =>
      postgres(getEnv().DATABASE_URL, { onnotice: () => undefined, max: 1 }),
    );
    try {
      await Promise.all(
        connections.map((client) => ensureRuntimeTestRole(drizzle({ client, schema }), role)),
      );
      const rows = await getDb().$client`select 1 from pg_roles where rolname = ${role}`;
      expect(rows).toHaveLength(1);
    } finally {
      await Promise.all(connections.map((client) => client.end()));
      await getDb().$client.unsafe(`drop role if exists ${role}`);
    }
  });
});

// Worker databases (WS-097): one per Vitest worker, copied from the migrated test database.
describe("ensureWorkerDatabase and dropWorkerDatabases", { timeout: 60_000 }, () => {
  it("copies the template once, with synchronous_commit off, and drops every copy", async () => {
    const template = freshName();
    await ensureTestDatabase(urlOf(template));
    const owner = postgres(urlOf(template), { onnotice: () => undefined, max: 1 });
    await owner`create table probe (id int)`;
    await owner`insert into probe values (1)`;
    await owner.end();
    const base = template.slice(0, -"_test".length);
    try {
      const url = await ensureWorkerDatabase(urlOf(template), "3");
      expect(new URL(url).pathname).toBe(`/${base}_w3_test`);
      expect(await ensureWorkerDatabase(urlOf(template), "3")).toBe(url);
      await ensureWorkerDatabase(urlOf(template), "12");

      const worker = postgres(url, { onnotice: () => undefined, max: 1 });
      try {
        expect(await worker`select id from probe`).toEqual([{ id: 1 }]);
        expect(await worker`show synchronous_commit`).toEqual([{ synchronous_commit: "off" }]);
      } finally {
        await worker.end();
      }

      expect((await dropWorkerDatabases(urlOf(template))).sort()).toEqual([
        `${base}_w12_test`,
        `${base}_w3_test`,
      ]);
      expect(await exists(`${base}_w3_test`)).toBe(false);
      expect(await exists(template)).toBe(true);
    } finally {
      await dropWorkerDatabases(urlOf(template));
      await dropTestDatabase(urlOf(template));
    }
  });

  it("refuses a template whose name does not end in _test", async () => {
    await expect(ensureWorkerDatabase(urlOf("opanel"), "1")).rejects.toThrow(/must end in "_test"/);
    await expect(dropWorkerDatabases(urlOf("opanel"))).rejects.toThrow(/must end in "_test"/);
  });
});

async function rowCounts(): Promise<Record<string, number>> {
  const tables = await getDb().execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const counts: Record<string, number> = {};
  for (const { tablename } of tables) {
    const [row] = await getDb().execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(tablename)}`,
    );
    counts[tablename] = row?.n ?? 0;
  }
  return counts;
}

describe("resetDatabase (WS-097)", () => {
  it("empties every table, the append-only ones included, and restores the role", async () => {
    const manager = await createTestAccount({ email: "manager@example.com", role: "manager" });
    await createProject(testActor(manager), { key: "ONE", name: "One" });
    await createTask(testActor(manager), "ONE", { title: "Kept nowhere" });
    const before = await rowCounts();
    expect(before.audit_log).toBeGreaterThan(0);
    expect(before.task_events).toBeGreaterThan(0);

    await resetDatabase();

    const after = await rowCounts();
    expect(Object.values(after).every((n) => n === 0)).toBe(true);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect(await getDb().$client`show session_replication_role`).toEqual([
      { session_replication_role: "origin" },
    ]);
  });

  it("reads the list of tables once: a table created later is not emptied", async () => {
    await getDb().execute(sql`create table ws097_probe (id int)`);
    try {
      await getDb().execute(sql`insert into ws097_probe values (1)`);
      await resetDatabase();
      expect(await getDb().execute(sql`select id from ws097_probe`)).toEqual([{ id: 1 }]);
    } finally {
      await getDb().execute(sql`drop table ws097_probe`);
    }
  });
});
