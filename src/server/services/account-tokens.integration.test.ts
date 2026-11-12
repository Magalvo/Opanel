import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestAccount } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { accountTokens } from "@/server/db/schema";

import { hashToken, issueLink } from "./account-tokens";

describe("issueLink", () => {
  it("stores only a SHA-256 hash: the token is in no column", async () => {
    const admin = await createTestAccount({ email: "admin@example.com", role: "admin" });
    const target = await createTestAccount({ email: "t@example.com" });

    const { token } = await issueLink(getDb(), {
      accountId: target.id,
      kind: "invitation",
      createdBy: admin.id,
    });

    const rows = await getDb().select().from(accountTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(hashToken(token));
    expect(rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it("expires after 7 days and starts unused", async () => {
    const admin = await createTestAccount({ email: "admin@example.com", role: "admin" });
    const { expiresAt } = await issueLink(getDb(), {
      accountId: admin.id,
      kind: "reset",
      createdBy: admin.id,
    });

    const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
    const [row] = await getDb().select().from(accountTokens);
    expect(row?.usedAt).toBeNull();
  });

  it("makes a different token each time and deletes the account's earlier unused links", async () => {
    const admin = await createTestAccount({ email: "admin@example.com", role: "admin" });
    const target = await createTestAccount({ email: "t@example.com" });
    const first = await issueLink(getDb(), {
      accountId: target.id,
      kind: "invitation",
      createdBy: admin.id,
    });
    const other = await issueLink(getDb(), {
      accountId: admin.id,
      kind: "reset",
      createdBy: admin.id,
    });

    const second = await issueLink(getDb(), {
      accountId: target.id,
      kind: "reset",
      createdBy: admin.id,
    });

    expect(second.token).not.toBe(first.token);
    const hashes = (await getDb().select().from(accountTokens)).map((row) => row.tokenHash).sort();
    expect(hashes).toEqual([hashToken(second.token), hashToken(other.token)].sort());
  });

  it("only allows the kinds invitation and reset", async () => {
    const admin = await createTestAccount({ email: "admin@example.com", role: "admin" });

    await expect(
      getDb().execute(sql`
        insert into account_tokens (account_id, kind, token_hash, expires_at, created_by)
        values (${admin.id}, 'other', 'x', now(), ${admin.id})`),
    ).rejects.toThrow();
  });
});
