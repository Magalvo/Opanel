import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { authenticate } from "@/server/auth/authenticate";
import {
  APP_ORIGIN,
  createTestAccount,
  failAuditFor,
  signInCookie,
  TEST_PASSWORD,
  testActor,
} from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { accounts, accountTokens, auditLog, credentials, sessions } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { issueResetLink } from "./account-management";
import { changeOwnPassword, renameSelf } from "./profile";
import { signIn } from "./sign-in";

const NEW_PASSWORD = "a brand new password 123";

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected a failure");
}

async function signedIn(role: "viewer" | "member" | "admin" = "member") {
  const account = await createTestAccount({ role });
  const cookie = await signInCookie();
  const { sessionId } = await authenticate(
    new Request(`${APP_ORIGIN}/api/v1/me`, { headers: { Cookie: cookie } }),
  );
  return { account, actor: testActor(account), sessionId, cookie };
}

function canSignIn(password: string, email = "ada@example.com") {
  return signIn({ email, password, clientIp: null, headers: new Headers() }).then(
    () => true,
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) return false;
      throw error;
    },
  );
}

async function auditActions(): Promise<string[]> {
  const rows = await getDb().select().from(auditLog).orderBy(auditLog.id);
  return rows.map((row) => row.action);
}

describe("renameSelf", () => {
  it("changes and trims the caller's name, and audits it with the caller as actor and no names", async () => {
    const { account, actor } = await signedIn("viewer");

    const row = await renameSelf(actor, "  Ada King ");

    expect(row.name).toBe("Ada King");
    const [stored] = await getDb().select().from(accounts).where(eq(accounts.id, account.id));
    expect(stored?.name).toBe("Ada King");
    const [entry] = await getDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "account.name_changed"));
    expect(entry).toMatchObject({ actorAccountId: account.id, entityId: account.id });
    expect(JSON.stringify(entry?.data ?? null)).not.toContain("Ada");
  });

  it("writes no audit row when the name does not change", async () => {
    const { actor } = await signedIn();

    await renameSelf(actor, " Ada ");

    expect(await auditActions()).not.toContain("account.name_changed");
  });
});

describe("changeOwnPassword", () => {
  it("replaces the password: the old one fails and the new one signs in", async () => {
    const { actor, sessionId } = await signedIn();

    await changeOwnPassword(actor, {
      sessionId,
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(await canSignIn(TEST_PASSWORD)).toBe(false);
    expect(await canSignIn(NEW_PASSWORD)).toBe(true);
    const [credential] = await getDb().select().from(credentials);
    expect(credential?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it("ends every other session of the account and keeps the caller's", async () => {
    const { account, actor, sessionId } = await signedIn();
    await signInCookie();
    await signInCookie();
    const other = await createTestAccount({ email: "grace@example.com" });
    await signInCookie("grace@example.com");

    await changeOwnPassword(actor, {
      sessionId,
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    const mine = await getDb().select().from(sessions).where(eq(sessions.accountId, account.id));
    expect(mine.map((row) => row.id)).toEqual([sessionId]);
    const theirs = await getDb().select().from(sessions).where(eq(sessions.accountId, other.id));
    expect(theirs).toHaveLength(1);
  });

  it("deletes the account's unused reset links and audits the change with via: self", async () => {
    const { account, actor, sessionId } = await signedIn();
    const admin = await createTestAccount({ email: "admin@example.com", role: "admin" });
    await issueResetLink(testActor(admin), account.id);

    await changeOwnPassword(actor, {
      sessionId,
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(
      await getDb().select().from(accountTokens).where(eq(accountTokens.accountId, account.id)),
    ).toEqual([]);
    const [entry] = await getDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "account.password_changed"));
    expect(entry).toMatchObject({
      actorAccountId: account.id,
      entityId: account.id,
      data: { via: "self" },
    });
  });

  it("refuses a wrong current password with a 400 on currentPassword, changing and auditing nothing", async () => {
    const { actor, sessionId } = await signedIn();
    await signInCookie();
    const before = await auditActions();

    const error = await failure(
      changeOwnPassword(actor, {
        sessionId,
        currentPassword: "not my password at all",
        newPassword: NEW_PASSWORD,
      }),
    );

    expect(error.status).toBe(400);
    expect(error.code).toBe("invalid_request");
    expect(error.errors).toEqual([
      { path: "currentPassword", message: "Is not your current password." },
    ]);
    expect(await canSignIn(TEST_PASSWORD)).toBe(true);
    expect(await getDb().select().from(sessions)).toHaveLength(3);
    expect((await auditActions()).filter((action) => !action.startsWith("auth."))).toEqual(
      before.filter((action) => !action.startsWith("auth.")),
    );
  });

  it("refuses the 11th attempt in 15 minutes with 429 and a retry delay, without auditing it", async () => {
    const { actor, sessionId } = await signedIn();
    const attempt = () =>
      changeOwnPassword(actor, { sessionId, currentPassword: "wrong", newPassword: NEW_PASSWORD });
    for (let i = 0; i < 10; i++) {
      expect((await failure(attempt())).status).toBe(400);
    }

    const refused = await failure(attempt());

    expect(refused.status).toBe(429);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(await auditActions()).not.toContain("account.password_changed");
  });

  it("keeps the old password and every session when the audit write fails", async () => {
    const { actor, sessionId } = await signedIn();
    await signInCookie();
    const restore = await failAuditFor("account.password_changed");

    try {
      await expect(
        changeOwnPassword(actor, {
          sessionId,
          currentPassword: TEST_PASSWORD,
          newPassword: NEW_PASSWORD,
        }),
      ).rejects.toThrow();
    } finally {
      await restore();
    }

    expect(await getDb().select().from(sessions)).toHaveLength(2);
    expect(await canSignIn(TEST_PASSWORD)).toBe(true);
  });
});
