import { and, eq, isNull } from "drizzle-orm";

import { type Actor, humanActor } from "@/server/auth/actor";
import { hashPassword } from "@/server/auth/password";
import { type Database, getDb } from "@/server/db/client";
import { accounts, accountTokens, credentials, sessions } from "@/server/db/schema";
import { invalidLink, rateLimited } from "@/server/http/errors";

import { hashToken } from "./account-tokens";
import { recordAudit } from "./audit";
import { ACCEPT_LINK_IP_RULE, consumeRateLimit, purgeExpiredRateLimits } from "./rate-limit";
import { signIn, type SignInResult } from "./sign-in";

export interface AcceptLinkInput {
  token: string;
  password: string;
  /** From `clientIpFrom`; null when no trusted header is configured. */
  clientIp: string | null;
  headers: Headers;
}

/**
 * Sets the password of the account a one-time link was issued for and signs the person in
 * (WS-019). Unknown, used, expired and replaced links, and links of deactivated accounts, are
 * one and the same `404`. A row lock on the link makes it single-use even when many requests
 * arrive together; the password, the link, the sessions and the audit entry commit together.
 * An invalid attempt writes nothing to the audit log, because anyone can make one.
 */
export async function acceptLink(
  input: AcceptLinkInput,
  db: Database = getDb(),
): Promise<SignInResult> {
  if (Math.random() < 0.02) {
    await purgeExpiredRateLimits(db);
  }
  if (input.clientIp !== null) {
    const attempt = await consumeRateLimit(db, `accept:ip:${input.clientIp}`, ACCEPT_LINK_IP_RULE);
    if (!attempt.allowed) {
      throw rateLimited(attempt.retryAfterSeconds);
    }
  }

  // Slow, so done before the transaction takes the row lock.
  const passwordHash = await hashPassword(input.password);

  const email = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ link: accountTokens, account: accounts })
      .from(accountTokens)
      .innerJoin(accounts, eq(accounts.id, accountTokens.accountId))
      .where(eq(accountTokens.tokenHash, hashToken(input.token)))
      .for("update", { of: accountTokens })
      .limit(1);

    if (!row) {
      throw invalidLink();
    }
    const { link, account } = row;
    const { email } = account;
    if (
      link.usedAt !== null ||
      link.expiresAt.getTime() <= Date.now() ||
      account.kind !== "human" ||
      account.disabledAt !== null ||
      email === null
    ) {
      throw invalidLink();
    }
    const actor: Actor = humanActor({ accountId: account.id, role: account.role as Actor["role"] });

    await tx.update(accountTokens).set({ usedAt: new Date() }).where(eq(accountTokens.id, link.id));
    await tx
      .insert(credentials)
      .values({
        accountId: account.id,
        providerId: "credential",
        providerAccountId: account.id,
        passwordHash,
      })
      .onConflictDoUpdate({
        target: [credentials.providerId, credentials.providerAccountId],
        set: { passwordHash, updatedAt: new Date() },
      });
    // Changing a password ends every earlier session (WT-02 decision 7); the new one is
    // created by the sign-in below.
    await tx.delete(sessions).where(eq(sessions.accountId, account.id));
    await tx
      .delete(accountTokens)
      .where(and(eq(accountTokens.accountId, account.id), isNull(accountTokens.usedAt)));

    await recordAudit(tx, {
      actor,
      action:
        link.kind === "invitation" ? "account.invitation_accepted" : "account.password_changed",
      entity: "account",
      entityId: account.id,
      ...(link.kind === "reset" ? { data: { via: "reset_link" } } : {}),
    });
    return email;
  });

  // Better Auth keeps its session outside this transaction (as in first-run setup): if this
  // fails the password is already set and the person can sign in normally.
  return signIn(
    { email, password: input.password, clientIp: input.clientIp, headers: input.headers },
    db,
  );
}
