import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb } from "../client";
import { accounts, credentials, sessions } from "./index";

const db = () => getDb();

async function insertHuman(overrides: Partial<typeof accounts.$inferInsert> = {}) {
  const [row] = await db()
    .insert(accounts)
    .values({
      kind: "human",
      name: "Ada",
      email: `ada-${crypto.randomUUID()}@example.com`,
      role: "member",
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

describe("accounts, credentials and sessions tables", () => {
  it("exist after migration", async () => {
    const rows = await db().execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    const names = rows.map((row) => row.tablename);

    expect(names).toEqual(expect.arrayContaining(["accounts", "credentials", "sessions"]));
  });

  it("fills in id, timestamps and defaults", async () => {
    const account = await insertHuman();

    expect(account.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(account.emailVerified).toBe(false);
    expect(account.disabledAt).toBeNull();
    expect(account.createdAt).toBeInstanceOf(Date);
  });

  it("rejects a human without an email", async () => {
    await expect(insertHuman({ email: null })).rejects.toThrow();
  });

  it("rejects a human whose role is not a human role", async () => {
    await expect(insertHuman({ role: "qa_agent" })).rejects.toThrow();
  });

  it("accepts an agent without an email and with an agent role", async () => {
    const agent = await insertHuman({ kind: "agent", email: null, role: "qa_agent" });

    expect(agent.kind).toBe("agent");
  });

  it("rejects an unknown kind", async () => {
    await expect(insertHuman({ kind: "robot" })).rejects.toThrow();
  });

  it("rejects a duplicate email but allows several accounts without one", async () => {
    await insertHuman({ email: "same@example.com" });
    await expect(insertHuman({ email: "same@example.com" })).rejects.toThrow();

    await insertHuman({ kind: "agent", email: null, role: "qa_agent", name: "a" });
    await insertHuman({ kind: "agent", email: null, role: "qa_agent", name: "b" });
  });

  it("deletes credentials and sessions with their account", async () => {
    const account = await insertHuman();
    await db().insert(credentials).values({
      accountId: account.id,
      providerId: "credential",
      providerAccountId: account.id,
      passwordHash: "hash",
    });
    await db()
      .insert(sessions)
      .values({
        accountId: account.id,
        token: "token-1",
        expiresAt: new Date(Date.now() + 60_000),
      });

    await db().delete(accounts).where(eq(accounts.id, account.id));

    expect(await db().select().from(credentials)).toHaveLength(0);
    expect(await db().select().from(sessions)).toHaveLength(0);
  });

  it("rejects a duplicate session token", async () => {
    const account = await insertHuman();
    const values = { accountId: account.id, token: "dup", expiresAt: new Date(Date.now() + 1000) };
    await db().insert(sessions).values(values);

    await expect(db().insert(sessions).values(values)).rejects.toThrow();
  });

  it("rejects a duplicate provider account", async () => {
    const account = await insertHuman();
    const values = {
      accountId: account.id,
      providerId: "credential",
      providerAccountId: "x",
      passwordHash: "h",
    };
    await db().insert(credentials).values(values);

    await expect(db().insert(credentials).values(values)).rejects.toThrow();
  });
});
