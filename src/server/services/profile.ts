import { and, eq, isNull, ne } from "drizzle-orm";

import type { Actor } from "@/server/auth/actor";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { type Database, getDb } from "@/server/db/client";
import { accounts, accountTokens, credentials, sessions } from "@/server/db/schema";
import { invalidRequest, notFound, rateLimited } from "@/server/http/errors";

import type { AccountRow } from "./accounts";
import { recordAudit } from "./audit";
import { CHANGE_PASSWORD_RULE, consumeRateLimit, purgeExpiredRateLimits } from "./rate-limit";

/**
 * Changes the caller's own name (WS-021). The audit entry carries no names: the
 * append-only log is not a place for personal data. Nothing is audited when the name is
 * the same.
 */
export async function renameSelf(
  actor: Actor,
  name: string,
  db: Database = getDb(),
): Promise<AccountRow> {
  const trimmed = name.trim();

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ name: accounts.name })
      .from(accounts)
      .where(eq(accounts.id, actor.accountId))
      .for("update")
      .limit(1);
    if (!before) {
      throw notFound();
    }

    const [account] = await tx
      .update(accounts)
      .set({ name: trimmed, updatedAt: new Date() })
      .where(eq(accounts.id, actor.accountId))
      .returning();
    if (!account) {
      throw notFound();
    }

    if (before.name !== trimmed) {
      await recordAudit(tx, {
        actor,
        action: "account.name_changed",
        entity: "account",
        entityId: actor.accountId,
      });
    }
    return account;
  });
}

export interface ChangeOwnPasswordInput {
  /** The session that asks: it stays signed in, every other one ends. */
  sessionId: string;
  currentPassword: string;
  newPassword: string;
}

function wrongCurrentPassword() {
  return invalidRequest([{ path: "currentPassword", message: "Is not your current password." }]);
}

/**
 * Replaces the caller's password after checking the current one (WS-021). Attempts are
 * limited per account. The new credential, the end of the other sessions, the removal of
 * unused reset links and the audit entry commit together; a failed attempt writes nothing
 * but the limiter counter.
 */
export async function changeOwnPassword(
  actor: Actor,
  input: ChangeOwnPasswordInput,
  db: Database = getDb(),
): Promise<void> {
  if (Math.random() < 0.02) {
    await purgeExpiredRateLimits(db);
  }
  const attempt = await consumeRateLimit(
    db,
    `password:account:${actor.accountId}`,
    CHANGE_PASSWORD_RULE,
  );
  if (!attempt.allowed) {
    throw rateLimited(attempt.retryAfterSeconds);
  }

  const [credential] = await db
    .select({ passwordHash: credentials.passwordHash })
    .from(credentials)
    .where(
      and(eq(credentials.accountId, actor.accountId), eq(credentials.providerId, "credential")),
    )
    .limit(1);
  const hash = credential?.passwordHash ?? null;
  if (hash === null || !(await verifyPassword({ hash, password: input.currentPassword }))) {
    throw wrongCurrentPassword();
  }

  // Slow, so done before the transaction.
  const passwordHash = await hashPassword(input.newPassword);

  await db.transaction(async (tx) => {
    await tx
      .update(credentials)
      .set({ passwordHash, updatedAt: new Date() })
      .where(
        and(eq(credentials.accountId, actor.accountId), eq(credentials.providerId, "credential")),
      );
    // WT-02 decision 7: the other sessions end; the one in use stays.
    await tx
      .delete(sessions)
      .where(and(eq(sessions.accountId, actor.accountId), ne(sessions.id, input.sessionId)));
    // A reset link an Admin issued is moot once the person chose a password.
    await tx
      .delete(accountTokens)
      .where(
        and(
          eq(accountTokens.accountId, actor.accountId),
          eq(accountTokens.kind, "reset"),
          isNull(accountTokens.usedAt),
        ),
      );
    await recordAudit(tx, {
      actor,
      action: "account.password_changed",
      entity: "account",
      entityId: actor.accountId,
      data: { via: "self" },
    });
  });
}
