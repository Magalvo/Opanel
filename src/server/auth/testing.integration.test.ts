import { randomBytes } from "node:crypto";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { getDb } from "@/server/db/client";
import { credentials } from "@/server/db/schema";
import { dropTestDatabase, ensureTestDatabase } from "@/server/db/testing";
import { getEnv } from "@/server/env";

import { verifyPassword } from "./password";
import { createTestAccount, TEST_PASSWORD, waitForAdvisoryLockWaiter } from "./testing";

async function hashOf(accountId: string): Promise<string> {
  const rows = await getDb().select().from(credentials);
  const row = rows.find((candidate) => candidate.accountId === accountId);
  if (!row?.passwordHash) throw new Error("no credential");
  return row.passwordHash;
}

describe("createTestAccount (WS-097)", () => {
  it("shares one hash of TEST_PASSWORD between default accounts", async () => {
    const ada = await createTestAccount({ email: "ada@example.com" });
    const bob = await createTestAccount({ email: "bob@example.com" });

    const hash = await hashOf(ada.id);
    expect(await hashOf(bob.id)).toBe(hash);
    expect(await verifyPassword({ hash, password: TEST_PASSWORD })).toBe(true);
  });

  it("hashes a password of the test's own", async () => {
    const ada = await createTestAccount({ email: "ada@example.com" });
    const own = await createTestAccount({ email: "own@example.com", password: "another secret" });

    const hash = await hashOf(own.id);
    expect(hash).not.toBe(await hashOf(ada.id));
    expect(await verifyPassword({ hash, password: "another secret" })).toBe(true);
  });
});

describe("waitForAdvisoryLockWaiter (WS-097)", () => {
  it("does not count a waiter in another database", { timeout: 60_000 }, async () => {
    const url = new URL(getEnv().DATABASE_URL);
    url.pathname = `/opanel_ws097_${randomBytes(4).toString("hex")}_test`;
    const other = url.toString();
    await ensureTestDatabase(other);
    const holder = postgres(other, { onnotice: () => undefined, max: 1 });
    const waiter = postgres(other, { onnotice: () => undefined, max: 1 });
    try {
      await holder`select pg_advisory_lock(97)`;
      const waiting = waiter`select pg_advisory_lock(97)`.execute();
      // The waiter really waits, in the other database, before the check.
      await expect
        .poll(async () => {
          const [row] = await holder<{ n: number }[]>`
            select count(*)::int as n from pg_locks
            where locktype = 'advisory' and not granted
              and database = (select oid from pg_database where datname = current_database())`;
          return row?.n;
        })
        .toBe(1);

      await expect(waitForAdvisoryLockWaiter(300)).rejects.toThrow(/nobody waited/);

      await holder`select pg_advisory_unlock(97)`;
      await waiting;
    } finally {
      await holder.end();
      await waiter.end();
      await dropTestDatabase(other);
    }
  });
});
