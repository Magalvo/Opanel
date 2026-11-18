import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb } from "../client";
import { accounts, accountTokens } from "./index";

const MIGRATIONS = join(process.cwd(), "src/server/db/migrations");

async function insertHuman(email: string) {
  const [row] = await getDb()
    .insert(accounts)
    .values({ kind: "human", name: "Ada", email, role: "member" })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row;
}

function link(
  accountId: string,
  createdBy: string,
  overrides: Partial<typeof accountTokens.$inferInsert> = {},
): typeof accountTokens.$inferInsert {
  return {
    accountId,
    kind: "reset",
    tokenHash: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 60_000),
    createdBy,
    ...overrides,
  };
}

/** The statement of migration 0013 that keeps only the newest unused link of an account. */
function dedupeStatement(): string {
  const file = readdirSync(MIGRATIONS).find((name) => name.startsWith("0013_"));
  if (!file) throw new Error("migration 0013 is missing");
  const [first] = readFileSync(join(MIGRATIONS, file), "utf8").split("--> statement-breakpoint");
  if (!first?.includes("DELETE")) throw new Error("migration 0013 does not start with the dedupe");
  return first;
}

class Rollback extends Error {}

describe("account_tokens: one unused link per account (WS-059)", () => {
  it("refuses a second unused link for an account, and allows any number of used ones", async () => {
    const account = await insertHuman("a@example.com");
    const used = new Date();
    await getDb()
      .insert(accountTokens)
      .values(link(account.id, account.id, { usedAt: used }));
    await getDb()
      .insert(accountTokens)
      .values(link(account.id, account.id, { usedAt: used }));
    await getDb().insert(accountTokens).values(link(account.id, account.id));

    await expect(
      getDb().insert(accountTokens).values(link(account.id, account.id)),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint_name: "account_tokens_one_unused_per_account" },
    });
    expect(
      await getDb()
        .select()
        .from(accountTokens)
        .where(and(eq(accountTokens.accountId, account.id), isNull(accountTokens.usedAt))),
    ).toHaveLength(1);
  });

  it("the migration's dedupe keeps the newest unused link of each account and every used one", async () => {
    const a = await insertHuman("a@example.com");
    const b = await insertHuman("b@example.com");
    const at = (minutes: number) => new Date(Date.UTC(2026, 10, 18, 10, minutes));

    let kept: string[] = [];
    await expect(
      getDb().transaction(async (tx) => {
        await tx.execute(sql`drop index account_tokens_one_unused_per_account`);
        await tx
          .insert(accountTokens)
          .values([
            link(a.id, a.id, { tokenHash: "a-old", createdAt: at(1) }),
            link(a.id, a.id, { tokenHash: "a-mid", createdAt: at(2) }),
            link(a.id, a.id, { tokenHash: "a-new", createdAt: at(3) }),
            link(b.id, b.id, { tokenHash: "b-unused", createdAt: at(1) }),
            link(b.id, b.id, { tokenHash: "b-used-1", createdAt: at(2), usedAt: at(2) }),
            link(b.id, b.id, { tokenHash: "b-used-2", createdAt: at(3), usedAt: at(3) }),
          ]);

        await tx.execute(sql.raw(dedupeStatement()));

        const rows = await tx.select({ tokenHash: accountTokens.tokenHash }).from(accountTokens);
        kept = rows.map((row) => row.tokenHash).sort();
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    expect(kept).toEqual(["a-new", "b-unused", "b-used-1", "b-used-2"]);
  });
});
