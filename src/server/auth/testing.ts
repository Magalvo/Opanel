import { eq } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { accounts, credentials } from "@/server/db/schema";

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
