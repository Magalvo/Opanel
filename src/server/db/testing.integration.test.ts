import { randomBytes } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { getEnv } from "@/server/env";

import { getDb } from "./client";
import * as schema from "./schema";
import { dropTestDatabase, ensureRuntimeTestRole, ensureTestDatabase } from "./testing";

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

describe("ensureTestDatabase and dropTestDatabase", () => {
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
