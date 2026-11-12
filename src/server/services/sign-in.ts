import { isAPIError } from "better-auth/api";

import type { AccountSummary } from "@/lib/schemas/auth";
import { type Actor, humanActor } from "@/server/auth/actor";
import { getAuth } from "@/server/auth/auth";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { type Database, getDb } from "@/server/db/client";
import { rateLimited, unauthenticated } from "@/server/http/errors";

import { type AccountRow, findAccountByEmail, touchLastSeen } from "./accounts";
import { recordAudit } from "./audit";
import {
  consumeRateLimit,
  purgeExpiredRateLimits,
  SIGN_IN_EMAIL_RULE,
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

export interface SignInResult {
  account: AccountSummary;
  /** Carries the `Set-Cookie` header of the new session. */
  headers: Headers;
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

async function auditFailure(
  db: Database,
  reason: "bad_credentials" | "disabled" | "rate_limited",
  accountId: string | undefined,
): Promise<void> {
  // No actor (nobody is authenticated) and never the email: people type passwords there.
  await recordAudit(db, {
    actor: null,
    action: "auth.sign_in_failed",
    entity: "account",
    ...(accountId === undefined ? {} : { entityId: accountId }),
    data: { reason },
  });
}

/**
 * Signs a person in. Wrong password, unknown email and deactivated account are one and the
 * same `401`. Limits are checked before the password is, so a blocked caller learns
 * nothing about it.
 */
export async function signIn(input: SignInInput, db: Database = getDb()): Promise<SignInResult> {
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
    await auditFailure(db, "rate_limited", undefined);
    throw rateLimited(Math.max(...blocked.map((attempt) => attempt.retryAfterSeconds)));
  }

  const account = await findAccountByEmail(db, input.email);
  if (account?.disabledAt !== null) {
    dummyHash ??= hashPassword("not the password of anyone");
    await verifyPassword({ hash: await dummyHash, password: input.password });
    await auditFailure(db, account ? "disabled" : "bad_credentials", account?.id);
    throw unauthenticated(INVALID_CREDENTIALS);
  }

  let cookies: Headers;
  try {
    const signedIn = await getAuth().api.signInEmail({
      body: { email: account.email ?? input.email, password: input.password },
      headers: input.headers,
      returnHeaders: true,
    });
    cookies = signedIn.headers;
  } catch (error) {
    if (!isAPIError(error)) {
      throw error;
    }
    await auditFailure(db, "bad_credentials", account.id);
    throw unauthenticated(INVALID_CREDENTIALS);
  }

  const actor = humanActor({ accountId: account.id, role: account.role as Actor["role"] });
  await db.transaction(async (tx) => {
    await touchLastSeen(tx, account.id);
    await recordAudit(tx, {
      actor,
      action: "auth.sign_in",
      entity: "account",
      entityId: account.id,
    });
  });

  return { account: summarize(account), headers: cookies };
}

/** Ends the caller's session. Returns the headers that clear the cookie. */
export async function signOut(
  input: { actor: Actor; headers: Headers },
  db: Database = getDb(),
): Promise<Headers> {
  const result = await getAuth().api.signOut({ headers: input.headers, returnHeaders: true });
  await recordAudit(db, {
    actor: input.actor,
    action: "auth.sign_out",
    entity: "account",
    entityId: input.actor.accountId,
  });
  return result.headers;
}
