import { createHash, randomBytes } from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "@/server/db/client";
import { accountTokens } from "@/server/db/schema";

export type LinkKind = "invitation" | "reset";

export const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type LinkExecutor = Pick<Database, "insert" | "delete">;

// Key space of the per-account advisory lock: the two-integer form, apart from the
// single-key Admin lock of WS-018.
const ACCOUNT_LOCK_SPACE = 7_201_024;

/**
 * Serialises the transactions that remove an invited account or set its first password
 * (WS-024). Taken before any row lock, so the two cannot deadlock on the account's links.
 * Released at the end of the transaction.
 */
export async function lockAccount(
  executor: Pick<Database, "execute">,
  accountId: string,
): Promise<void> {
  await executor.execute(
    sql`select pg_advisory_xact_lock(${ACCOUNT_LOCK_SPACE}, hashtext(${accountId}))`,
  );
}

/** The only form of a token that is ever stored. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issues a one-time link token for an account: 32 random bytes, valid for 7 days. Earlier
 * unused links of the same account are deleted, so only the newest works. Returns the token
 * once; only its hash is stored.
 */
export async function issueLink(
  executor: LinkExecutor,
  input: { accountId: string; kind: LinkKind; createdBy: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + LINK_TTL_MS);

  await executor
    .delete(accountTokens)
    .where(and(eq(accountTokens.accountId, input.accountId), isNull(accountTokens.usedAt)));
  await executor.insert(accountTokens).values({
    accountId: input.accountId,
    kind: input.kind,
    tokenHash: hashToken(token),
    expiresAt,
    createdBy: input.createdBy,
  });

  return { token, expiresAt };
}
