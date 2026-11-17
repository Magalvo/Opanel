import { sql } from "drizzle-orm";

import { type Actor, humanActor } from "@/server/auth/actor";
import { hashPassword } from "@/server/auth/password";
import { setupTokenMatches } from "@/server/auth/setup-token";
import { type Database, getDb } from "@/server/db/client";
import { accounts, credentials } from "@/server/db/schema";
import { type Env, getEnv } from "@/server/env";
import { invalidSetupToken, notFound } from "@/server/http/errors";

import { recordAudit } from "./audit";
import { signIn, type SignInResult } from "./sign-in";

// Key of the advisory lock that serialises first-run setup. Any constant will do.
const SETUP_LOCK_KEY = 7_201_016;

export interface CreateFirstAdminInput {
  name: string;
  email: string;
  password: string;
  /** Required when the server has a setup token configured (WS-050). */
  setupToken?: string | undefined;
  clientIp: string | null;
  headers: Headers;
}

export interface CreateFirstAdminOptions {
  /** The configured setup token; read from the environment unless a test passes one. */
  expectedSetupToken?: string | undefined;
}

/** True while the install has no accounts at all. */
export async function isSetupNeeded(db: Pick<Database, "select"> = getDb()): Promise<boolean> {
  const rows = await db.select({ id: accounts.id }).from(accounts).limit(1);
  return rows.length === 0;
}

/**
 * True when the server has a setup token configured, so the setup form must ask for it
 * (WS-050). Says only that one exists, never what it is.
 */
export function isSetupTokenRequired(env: Pick<Env, "SETUP_TOKEN"> = getEnv()): boolean {
  return env.SETUP_TOKEN !== undefined;
}

/**
 * Creates the first Admin and signs them in. Answers `404` if any account exists, however
 * many requests arrive at once: a transaction-scoped advisory lock makes them queue, so
 * exactly one sees an empty table. The account, its credential and the audit entry commit
 * together; the sign-in that follows creates a session outside that transaction.
 *
 * An installed server answers `404` before hashing anything (WS-043): the endpoint is
 * public, and a hash is expensive. That first look is only a shortcut; the check under the
 * lock is the one that decides.
 *
 * When a setup token is configured, a missing or wrong one is refused next, still before
 * hashing and with nothing written (WS-050). A refusal is not audited: the caller is
 * anonymous and changed nothing.
 */
export async function createFirstAdmin(
  input: CreateFirstAdminInput,
  db: Database = getDb(),
  { expectedSetupToken = getEnv().SETUP_TOKEN }: CreateFirstAdminOptions = {},
): Promise<SignInResult> {
  if (!(await isSetupNeeded(db))) {
    throw notFound();
  }
  if (
    expectedSetupToken !== undefined &&
    !setupTokenMatches(expectedSetupToken, input.setupToken)
  ) {
    throw invalidSetupToken();
  }
  // Slow, so done before the transaction takes the lock.
  const passwordHash = await hashPassword(input.password);
  const email = input.email.trim().toLowerCase();

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SETUP_LOCK_KEY})`);
    if (!(await isSetupNeeded(tx))) {
      throw notFound();
    }

    const [account] = await tx
      .insert(accounts)
      .values({ kind: "human", name: input.name.trim(), email, role: "admin" })
      .returning();
    if (!account) {
      throw new Error("The first admin was not created.");
    }
    await tx.insert(credentials).values({
      accountId: account.id,
      providerId: "credential",
      providerAccountId: account.id,
      passwordHash,
    });
    const actor: Actor = humanActor({ accountId: account.id, role: "admin" });
    await recordAudit(tx, {
      actor,
      action: "setup.first_admin_created",
      entity: "account",
      entityId: account.id,
    });
  });

  // Trusted: the password was set just now on an empty install, so the sign-in limiter
  // neither refuses nor counts this sign-in (WS-040).
  return signIn(
    { email, password: input.password, clientIp: input.clientIp, headers: input.headers },
    db,
    { trusted: true },
  );
}
