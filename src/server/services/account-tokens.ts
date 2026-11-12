import { createHash, randomBytes } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "@/server/db/client";
import { accountTokens } from "@/server/db/schema";

export type LinkKind = "invitation" | "reset";

export const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type LinkExecutor = Pick<Database, "insert" | "delete">;

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
