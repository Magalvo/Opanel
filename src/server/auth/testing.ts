import { eq, sql } from "drizzle-orm";

import type { AgentRole, AgentScope, HumanRole } from "@/lib/schemas/permissions";
import { getDb } from "@/server/db/client";
import { accounts, agentProjects, agentScopes, credentials } from "@/server/db/schema";
import { lockAccount } from "@/server/services/account-tokens";

import { type Actor, humanActor } from "./actor";
import { getAuth } from "./auth";
import { hashPassword } from "./password";

export const TEST_PASSWORD = "correct horse battery staple";

/** Creates a human account with a password credential, directly in the test database. */
export async function createTestAccount(
  overrides: {
    name?: string;
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
      name: overrides.name ?? "Ada",
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

/**
 * Creates an agent account with its scopes and projects, directly in the test database
 * (the API to create agents is WT-05 item C). `projectIds: null` means all projects.
 */
export async function createTestAgent(
  overrides: {
    name?: string;
    role?: AgentRole;
    scopes?: AgentScope[];
    projectIds?: string[] | null;
    disabled?: boolean;
  } = {},
) {
  const db = getDb();
  const projectIds = overrides.projectIds === undefined ? null : overrides.projectIds;
  const [account] = await db
    .insert(accounts)
    .values({
      kind: "agent",
      name: overrides.name ?? "QA Bot",
      role: overrides.role ?? "qa_agent",
      allProjects: projectIds === null,
      disabledAt: overrides.disabled ? new Date() : null,
    })
    .returning();
  if (!account) throw new Error("no agent");
  const scopes = overrides.scopes ?? ["projects:read", "tasks:read"];
  if (scopes.length > 0) {
    await db.insert(agentScopes).values(scopes.map((scope) => ({ accountId: account.id, scope })));
  }
  if (projectIds !== null && projectIds.length > 0) {
    await db
      .insert(agentProjects)
      .values(projectIds.map((projectId) => ({ accountId: account.id, projectId })));
  }
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
  return humanActor({ accountId: account.id, role: account.role as HumanRole });
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

/** Makes every delete of a session row fail, to test what happens when cleanup fails too. */
export async function failSessionDeletes(): Promise<() => Promise<void>> {
  await getDb().execute(
    sql.raw(`
    create function fail_test_session_delete() returns trigger as $$
    begin raise exception 'session delete failed'; end;
    $$ language plpgsql`),
  );
  await getDb().execute(
    sql.raw(`
    create trigger fail_test_session_delete before delete on sessions
    for each row execute function fail_test_session_delete()`),
  );
  return async () => {
    await getDb().execute(sql`drop trigger fail_test_session_delete on sessions`);
    await getDb().execute(sql`drop function fail_test_session_delete()`);
  };
}

/**
 * Resolves once `count` sessions wait for an advisory lock that another one holds, so a test
 * can release the holder at a known point, or queue operations in a known order: PostgreSQL
 * grants a contended lock to its waiters in the order they asked (WS-059). Throws after
 * `timeoutMs` (a caller that never takes the lock).
 */
export async function waitForAdvisoryLockWaiter(timeoutMs = 3000, count = 1): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const waiting = await getDb().execute<{ n: number }>(
      sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`,
    );
    if ((waiting[0]?.n ?? 0) >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("nobody waited for the advisory lock");
}

/**
 * Holds the per-account lock in a transaction of its own until `release()` is called
 * (WS-059). `release()` resolves once that transaction has ended.
 */
export async function holdAccountLock(
  accountId: string,
): Promise<{ release: () => Promise<void> }> {
  let open = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    open = resolve;
  });
  let locked = (): void => undefined;
  const isLocked = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const holder = getDb().transaction(async (tx) => {
    await lockAccount(tx, accountId);
    locked();
    await held;
  });
  await isLocked;
  return {
    release: async () => {
      open();
      await holder;
    },
  };
}
