import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb } from "./client";
import { resetDatabase } from "./testing";

describe("database client", () => {
  beforeAll(async () => {
    await getDb().execute(sql`create table if not exists harness_probe (id integer primary key)`);
  });

  afterAll(async () => {
    await getDb().execute(sql`drop table if exists harness_probe`);
  });

  async function countProbeRows(): Promise<number> {
    const rows = await getDb().execute<{ count: number }>(
      sql`select count(*)::int as count from harness_probe`,
    );
    return rows[0]?.count ?? -1;
  }

  it("runs a real query", async () => {
    const rows = await getDb().execute<{ one: number }>(sql`select 1 as one`);

    expect(rows[0]?.one).toBe(1);
  });

  it("is connected to the test database", async () => {
    const rows = await getDb().execute<{ name: string }>(sql`select current_database() as name`);

    expect(rows[0]?.name).toMatch(/_test$/);
  });

  it("returns the same instance on repeated calls", () => {
    expect(getDb()).toBe(getDb());
  });

  it("resetDatabase removes rows written by a test", async () => {
    await getDb().execute(sql`insert into harness_probe (id) values (1), (2)`);
    expect(await countProbeRows()).toBe(2);

    await resetDatabase();

    expect(await countProbeRows()).toBe(0);
  });

  it("starts every test with empty tables", async () => {
    // The previous test left nothing behind even without its explicit reset,
    // because the harness resets before each test.
    await getDb().execute(sql`insert into harness_probe (id) values (1)`);
    expect(await countProbeRows()).toBe(1);
  });

  it("starts every test with empty tables (continued)", async () => {
    expect(await countProbeRows()).toBe(0);
  });

  it("rolls back a transaction that throws", async () => {
    const attempt = getDb().transaction(async (tx) => {
      await tx.execute(sql`insert into harness_probe (id) values (7)`);
      throw new Error("boom");
    });

    await expect(attempt).rejects.toThrow("boom");
    expect(await countProbeRows()).toBe(0);
  });
});
