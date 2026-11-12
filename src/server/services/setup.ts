import { sql } from "drizzle-orm";

import { type Actor, humanActor } from "@/server/auth/actor";
import { hashPassword } from "@/server/auth/password";
import { type Database, getDb } from "@/server/db/client";
import { accounts, credentials } from "@/server/db/schema";
import { notFound } from "@/server/http/errors";

import { recordAudit } from "./audit";
import { signIn, type SignInResult } from "./sign-in";

// Key of the advisory lock that serialises first-run setup. Any constant will do.
const SETUP_LOCK_KEY = 7_201_016;

export interface CreateFirstAdminInput {
  name: string;
  email: string;
  password: string;
  clientIp: string | null;
  headers: Headers;
}

/** True while the install has no accounts at all. */
export async function isSetupNeeded(db: Pick<Database, "select"> = getDb()): Promise<boolean> {
  const rows = await db.select({ id: accounts.id }).from(accounts).limit(1);
  return rows.length === 0;
}

/**
 * Creates the first Admin and signs them in. Answers `404` if any account exists, however
 * many requests arrive at once: a transaction-scoped advisory lock makes them queue, so
 * exactly one sees an empty table. The account, its credential and the audit entry commit
 * together; the sign-in that follows creates a session outside that transaction.
 */
export async function createFirstAdmin(
  input: CreateFirstAdminInput,
  db: Database = getDb(),
): Promise<SignInResult> {
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

  return signIn(
    { email, password: input.password, clientIp: input.clientIp, headers: input.headers },
    db,
  );
}
