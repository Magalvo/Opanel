import { isAPIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";

import type { AccountSummary } from "@/lib/schemas/auth";
import { type Actor, humanActor } from "@/server/auth/actor";
import { getAuth } from "@/server/auth/auth";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { type Database, getDb } from "@/server/db/client";
import { accounts, credentials, sessions } from "@/server/db/schema";
import { rateLimited, unauthenticated } from "@/server/http/errors";
import { describeError } from "@/server/http/safe-error";

import { lockAccount } from "./account-tokens";
import { type AccountRow, findAccountByEmail, touchLastSeen } from "./accounts";
import { recordAudit } from "./audit";
import {
  consumeRateLimit,
  purgeExpiredRateLimits,
  type RateLimitRule,
  SIGN_IN_EMAIL_RULE,
  SIGN_IN_FAILURE_AUDIT_KEY,
  SIGN_IN_FAILURE_AUDIT_RULE,
  SIGN_IN_IP_RULE,
  signInKeys,
} from "./rate-limit";

export interface SignInInput {
  email: string;
  password: string;
  /** From `clientIpFrom`; null when no trusted header is configured. */
  clientIp: string | null;
  /** The request's headers, so Better Auth can record the user agent. */
  headers: Headers;
}

export interface SignInOptions {
  /** The install-wide budget of failure audit rows. Tests lower it. */
  failureAuditRule?: RateLimitRule;
  /**
   * Only for callers that have just set this password themselves, in a committed
   * transaction, from input that passed its own check: accepting a valid one-time link and
   * first-run setup (WS-040). The sign-in limiter neither refuses nor counts the attempt;
   * its counters are left as they are. The password is still verified. Never set it from
   * request input: the sign-in endpoint calls `signIn` without options.
   */
  trusted?: boolean;
  /** Where a failed cleanup is reported (WS-058). Tests replace it. */
  logError?: (message: string) => void;
}

export interface SignInResult {
  account: AccountSummary;
  /** Carries the `Set-Cookie` header of the new session. */
  headers: Headers;
}

export interface AfterCommitSignIn extends SignInResult {
  /** False when the change was committed but no session could be made (WS-057). */
  signedIn: boolean;
}

export interface AfterCommitOptions {
  logError?: (message: string) => void;
  /** Tests make the sign-in fail through this; callers leave it unset. */
  signIn?: (input: SignInInput, db: Database, options: SignInOptions) => Promise<SignInResult>;
}

/**
 * Signs in a person whose password was just committed by the caller (WS-057): accepting a
 * link, and first-run setup. The change stands whatever happens here, so a failure is not
 * thrown: it is logged without its message (WS-042) and answered as `signedIn: false`, with
 * no cookie, and the person signs in normally.
 */
export async function signInAfterCommit(
  input: SignInInput,
  account: AccountSummary,
  db: Database,
  { logError = console.error, signIn: signInWith = signIn }: AfterCommitOptions = {},
): Promise<AfterCommitSignIn> {
  try {
    // Trusted: the caller has just set this password from input that passed its own check.
    return { ...(await signInWith(input, db, { trusted: true })), signedIn: true };
  } catch (error) {
    logError(`Signing in after a committed password change failed: ${describeError(error)}`);
    return { account, headers: new Headers(), signedIn: false };
  }
}

const INVALID_CREDENTIALS = "Invalid email or password.";

// Hashed once, on first use: a password check against it costs what a real one costs.
let dummyHash: Promise<string> | undefined;

export function summarize(account: AccountRow): AccountSummary {
  return {
    id: account.id,
    kind: account.kind === "agent" ? "agent" : "human",
    name: account.name,
    email: account.email,
    role: account.role,
  };
}

/**
 * Audits a failed sign-in while the install-wide budget lasts (WS-022). The audit log is
 * append-only and this is reachable without signing in, so the number of rows it can write
 * is capped: the row that uses up the budget says that more were suppressed, and after it
 * nothing is written until the window ends. The budget is consumed on every failure, known
 * email or not, so it cannot tell the two apart, and it never changes the response.
 */
async function auditFailure(
  db: Database,
  rule: RateLimitRule,
  reason: "bad_credentials" | "disabled" | "rate_limited",
  accountId: string | undefined,
): Promise<void> {
  const budget = await consumeRateLimit(db, SIGN_IN_FAILURE_AUDIT_KEY, rule);
  if (!budget.allowed) {
    return;
  }
  // No actor (nobody is authenticated) and never the email: people type passwords there.
  await recordAudit(db, {
    actor: null,
    action: "auth.sign_in_failed",
    entity: "account",
    ...(accountId === undefined ? {} : { entityId: accountId }),
    data: { reason, ...(budget.remaining === 0 ? { moreSuppressed: true } : {}) },
  });
}

/**
 * Consumes the sign-in limiter's counters for one attempt, and refuses it with `429` when
 * the email or the address is over its limit.
 */
async function checkLimits(
  db: Database,
  input: SignInInput,
  failureAuditRule: RateLimitRule,
): Promise<void> {
  if (Math.random() < 0.02) {
    await purgeExpiredRateLimits(db);
  }

  const keys = signInKeys(input.email, input.clientIp);
  const attempts = [await consumeRateLimit(db, keys.email, SIGN_IN_EMAIL_RULE)];
  if (keys.ip !== null) {
    attempts.push(await consumeRateLimit(db, keys.ip, SIGN_IN_IP_RULE));
  }
  const blocked = attempts.filter((attempt) => !attempt.allowed);
  if (blocked.length > 0) {
    // Once per key and window: repeating a refused attempt writes nothing more.
    if (blocked.some((attempt) => attempt.firstRefusal)) {
      await auditFailure(db, failureAuditRule, "rate_limited", undefined);
    }
    throw rateLimited(Math.max(...blocked.map((attempt) => attempt.retryAfterSeconds)));
  }
}

/** The account's password hash, or null when it has none. */
async function passwordHashOf(
  executor: Pick<Database, "select">,
  accountId: string,
): Promise<string | null> {
  const [credential] = await executor
    .select({ passwordHash: credentials.passwordHash })
    .from(credentials)
    .where(and(eq(credentials.accountId, accountId), eq(credentials.providerId, "credential")))
    .limit(1);
  return credential?.passwordHash ?? null;
}

/**
 * Removes a session that Better Auth created for a sign-in that is then not completed
 * (WS-058). A failure here is logged without its message; the caller throws its own error.
 */
async function removeSession(
  db: Database,
  token: string,
  logError: (message: string) => void,
): Promise<void> {
  try {
    await db.delete(sessions).where(eq(sessions.token, token));
  } catch (error) {
    logError(`A session may remain after a failed sign-in audit: ${describeError(error)}`);
  }
}

/**
 * Signs a person in. Wrong password, unknown email and deactivated account are one and the
 * same `401`. Limits are checked before the password is, so a blocked caller learns
 * nothing about it. A `trusted` caller skips the limits (see `SignInOptions`).
 *
 * Better Auth inserts the session in its own statement. Then, under the account lock that
 * password changes also take, the account is checked again: if it was deactivated or its
 * password changed meanwhile, the session is deleted and the attempt answers `401`;
 * otherwise `last_seen_at` and `auth.sign_in` are written. If that transaction fails, the
 * session is deleted again, so a sign-in never leaves an unaudited session behind it
 * (WS-058; only a crash between the two steps can).
 */
export async function signIn(
  input: SignInInput,
  db: Database = getDb(),
  {
    failureAuditRule = SIGN_IN_FAILURE_AUDIT_RULE,
    trusted = false,
    logError = console.error,
  }: SignInOptions = {},
): Promise<SignInResult> {
  if (!trusted) {
    await checkLimits(db, input, failureAuditRule);
  }

  const account = await findAccountByEmail(db, input.email);
  if (account?.disabledAt !== null) {
    dummyHash ??= hashPassword("not the password of anyone");
    await verifyPassword({ hash: await dummyHash, password: input.password });
    await auditFailure(db, failureAuditRule, account ? "disabled" : "bad_credentials", account?.id);
    throw unauthenticated(INVALID_CREDENTIALS);
  }

  // The hash the password is checked against, unless a change commits meanwhile.
  const hashBefore = await passwordHashOf(db, account.id);

  let cookies: Headers;
  let token: string;
  try {
    const signedIn = await getAuth().api.signInEmail({
      body: { email: account.email ?? input.email, password: input.password },
      headers: input.headers,
      returnHeaders: true,
    });
    cookies = signedIn.headers;
    token = signedIn.response.token;
  } catch (error) {
    if (!isAPIError(error)) {
      throw error;
    }
    await auditFailure(db, failureAuditRule, "bad_credentials", account.id);
    throw unauthenticated(INVALID_CREDENTIALS);
  }

  const actor = humanActor({ accountId: account.id, role: account.role as Actor["role"] });
  let completed: boolean;
  try {
    completed = await db.transaction(async (tx) => {
      await lockAccount(tx, account.id);
      const [now] = await tx
        .select({ disabledAt: accounts.disabledAt })
        .from(accounts)
        .where(eq(accounts.id, account.id))
        .limit(1);
      if (now?.disabledAt !== null || (await passwordHashOf(tx, account.id)) !== hashBefore) {
        // Deactivated or given a new password while this attempt was in flight.
        await tx.delete(sessions).where(eq(sessions.token, token));
        return false;
      }
      await touchLastSeen(tx, account.id);
      await recordAudit(tx, {
        actor,
        action: "auth.sign_in",
        entity: "account",
        entityId: account.id,
      });
      return true;
    });
  } catch (error) {
    await removeSession(db, token, logError);
    throw error;
  }
  if (!completed) {
    await auditFailure(db, failureAuditRule, "bad_credentials", account.id);
    throw unauthenticated(INVALID_CREDENTIALS);
  }

  return { account: summarize(account), headers: cookies };
}

/**
 * Ends the caller's session: the row is deleted and `auth.sign_out` recorded in one
 * transaction (WS-058). Better Auth is then asked only for the headers that clear the
 * cookie; its own delete finds nothing left. Returns those headers.
 */
export async function signOut(
  input: { actor: Actor; sessionId: string; headers: Headers },
  db: Database = getDb(),
): Promise<Headers> {
  await db.transaction(async (tx) => {
    await tx
      .delete(sessions)
      .where(and(eq(sessions.id, input.sessionId), eq(sessions.accountId, input.actor.accountId)));
    await recordAudit(tx, {
      actor: input.actor,
      action: "auth.sign_out",
      entity: "account",
      entityId: input.actor.accountId,
    });
  });
  const result = await getAuth().api.signOut({ headers: input.headers, returnHeaders: true });
  return result.headers;
}
