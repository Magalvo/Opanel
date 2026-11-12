import { eq, sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { accounts, credentials } from "@/server/db/schema";

import { type Actor, humanActor } from "./actor";
import { getAuth } from "./auth";
import { hashPassword } from "./password";

export const TEST_PASSWORD = "correct horse battery staple";

/** Creates a human account with a password credential, directly in the test database. */
export async function createTestAccount(
  overrides: {
    email?: string;
    role?: "admin" | "manager" | "member" | "viewer";
    password?: string;
    disabled?: boolean;
  } = {},
) {
  const db = getDb();
  const [account] = await db
    .insert(accounts)
    .values({
      kind: "human",
      name: "Ada",
      email: overrides.email ?? "ada@example.com",
      role: overrides.role ?? "member",
      disabledAt: overrides.disabled ? new Date() : null,
    })
    .returning();
  if (!account) throw new Error("no account");
  await db.insert(credentials).values({
    accountId: account.id,
    providerId: "credential",
    providerAccountId: account.id,
    passwordHash: await hashPassword(overrides.password ?? TEST_PASSWORD),
  });
  return account;
}

/** Turns Set-Cookie headers into the value of a Cookie request header. */
export function cookieHeaderFrom(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** Signs an existing test account in through Better Auth and returns its Cookie header. */
export async function signInCookie(
  email = "ada@example.com",
  password = TEST_PASSWORD,
): Promise<string> {
  const { headers } = await getAuth().api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  return cookieHeaderFrom(headers);
}

export async function setDisabled(accountId: string, disabled: boolean): Promise<void> {
  await getDb()
    .update(accounts)
    .set({ disabledAt: disabled ? new Date() : null })
    .where(eq(accounts.id, accountId));
}

export const APP_ORIGIN = "http://localhost:3000";

/** A same-origin JSON POST, as the web UI sends it. */
export function postRequest(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${APP_ORIGIN}${path}`, {
    method: "POST",
    headers: {
      Origin: APP_ORIGIN,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** The `Actor` of a test account, as `authenticate` would build it. */
export function testActor(account: { id: string; role: string }): Actor {
  return humanActor({ accountId: account.id, role: account.role as Actor["role"] });
}

/**
 * A same-origin API request with a session cookie, as the web UI sends it. `body` is sent
 * as JSON when given.
 */
export function apiRequest(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
): Request {
  return new Request(`${APP_ORIGIN}${path}`, {
    method,
    headers: {
      ...(method === "GET" ? {} : { Origin: APP_ORIGIN }),
      ...(options.cookie === undefined ? {} : { Cookie: options.cookie }),
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

/** Makes every audit write for `action` fail, to prove a change and its audit row are one. */
export async function failAuditFor(action: string): Promise<() => Promise<void>> {
  await getDb().execute(
    sql.raw(`
    create function fail_test_audit() returns trigger as $$
    begin raise exception 'audit write failed'; end;
    $$ language plpgsql`),
  );
  await getDb().execute(
    sql.raw(`
    create trigger fail_test_audit before insert on audit_log
    for each row when (new.action = '${action}')
    execute function fail_test_audit()`),
  );
  return async () => {
    await getDb().execute(sql`drop trigger fail_test_audit on audit_log`);
    await getDb().execute(sql`drop function fail_test_audit()`);
  };
}
