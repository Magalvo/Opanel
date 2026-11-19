import { and, eq, isNull } from "drizzle-orm";

import type { HumanRole } from "@/lib/schemas/permissions";
import { type Actor, humanActor } from "@/server/auth/actor";
import { hashPassword as defaultHashPassword } from "@/server/auth/password";
import { type Database, getDb } from "@/server/db/client";
import { accounts, accountTokens, credentials, sessions } from "@/server/db/schema";
import { invalidLink, rateLimited } from "@/server/http/errors";

import { hashToken, lockAccount } from "./account-tokens";
import { recordAudit } from "./audit";
import { ACCEPT_LINK_IP_RULE, consumeRateLimit, purgeExpiredRateLimits } from "./rate-limit";
import {
  type AfterCommitOptions,
  type AfterCommitSignIn,
  signInAfterCommit,
  summarize,
} from "./sign-in";

export interface AcceptLinkOptions extends AfterCommitOptions {
  /** The password hasher. Tests inject a spy to see whether it ran. */
  hashPassword?: (password: string) => Promise<string>;
}

type LinkRow = typeof accountTokens.$inferSelect;
type AccountRow = typeof accounts.$inferSelect;

/**
 * Whether a link can still be accepted: unused, unexpired, and issued for an active human
 * account with an email. Used by both the first look and the locked check, so they agree.
 */
function isAcceptable(
  link: LinkRow,
  account: AccountRow,
): account is AccountRow & {
  email: string;
} {
  return (
    link.usedAt === null &&
    link.expiresAt.getTime() > Date.now() &&
    account.kind === "human" &&
    account.disabledAt === null &&
    account.email !== null
  );
}

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
 *
 * A first look at the link, without a lock, refuses an invalid one before the slow password
 * hash runs (WS-040); the check under the lock is the one that decides.
 */
export async function acceptLink(
  input: AcceptLinkInput,
  db: Database = getDb(),
  { hashPassword = defaultHashPassword, ...afterCommit }: AcceptLinkOptions = {},
): Promise<AfterCommitSignIn> {
  if (Math.random() < 0.02) {
    await purgeExpiredRateLimits(db);
  }
  if (input.clientIp !== null) {
    const attempt = await consumeRateLimit(db, `accept:ip:${input.clientIp}`, ACCEPT_LINK_IP_RULE);
    if (!attempt.allowed) {
      throw rateLimited(attempt.retryAfterSeconds);
    }
  }

  const tokenHash = hashToken(input.token);
  const [first] = await db
    .select({ link: accountTokens, account: accounts })
    .from(accountTokens)
    .innerJoin(accounts, eq(accounts.id, accountTokens.accountId))
    .where(eq(accountTokens.tokenHash, tokenHash))
    .limit(1);
  if (!first || !isAcceptable(first.link, first.account)) {
    throw invalidLink();
  }

  // Slow, so done before the transaction takes the row lock.
  const passwordHash = await hashPassword(input.password);

  const committed = await db.transaction(async (tx) => {
    // Serialise with a revocation of the same invitation before locking any row (WS-024).
    const [owner] = await tx
      .select({ accountId: accountTokens.accountId })
      .from(accountTokens)
      .where(eq(accountTokens.tokenHash, tokenHash))
      .limit(1);
    if (owner) {
      await lockAccount(tx, owner.accountId);
    }

    const [row] = await tx
      .select({ link: accountTokens, account: accounts })
      .from(accountTokens)
      .innerJoin(accounts, eq(accounts.id, accountTokens.accountId))
      .where(eq(accountTokens.tokenHash, tokenHash))
      .for("update", { of: accountTokens })
      .limit(1);

    if (!row) {
      throw invalidLink();
    }
    const { link, account } = row;
    if (!isAcceptable(link, account)) {
      throw invalidLink();
    }
    const { email } = account;
    const actor: Actor = humanActor({ accountId: account.id, role: account.role as HumanRole });

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
    return { email, summary: summarize(account) };
  });

  // Better Auth keeps its session outside this transaction (as in first-run setup). If
  // signing in fails now, the password is already set: the answer is still a success, with
  // `signedIn: false`, and the person signs in normally (WS-057). Trusted: the valid link
  // just proved who this is, so the sign-in limiter neither refuses nor counts it.
  return signInAfterCommit(
    {
      email: committed.email,
      password: input.password,
      clientIp: input.clientIp,
      headers: input.headers,
    },
    committed.summary,
    db,
    afterCommit,
  );
}
