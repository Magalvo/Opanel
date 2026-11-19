import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { hashPassword } from "@/server/auth/password";
import {
  APP_ORIGIN,
  authenticateSession,
  cookieHeaderFrom,
  createTestAccount,
  failAuditFor,
  failSessionDeletes,
  setDisabled,
  TEST_PASSWORD,
  testActor,
  waitForAdvisoryLockWaiter,
} from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { accounts, auditLog, credentials, rateLimits, sessions } from "@/server/db/schema";
import { ApiError, serverBusy } from "@/server/http/errors";

import { lockAccount } from "./account-tokens";
import { changeOwnPassword } from "./profile";
import { signIn, signInAfterCommit, signOut } from "./sign-in";

const base = { headers: new Headers(), clientIp: null };

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected a failure");
}

describe("signIn", () => {
  it("returns the account and a cookie, sets last_seen_at and audits it with the account as actor", async () => {
    const account = await createTestAccount({ role: "manager" });

    const result = await signIn({ ...base, email: "ada@example.com", password: TEST_PASSWORD });

    expect(result.account).toEqual({
      id: account.id,
      kind: "human",
      name: "Ada",
      email: "ada@example.com",
      role: "manager",
    });
    expect(result.headers.getSetCookie().length).toBeGreaterThan(0);
    const [row] = await getDb().select().from(accounts).where(eq(accounts.id, account.id));
    expect(row?.lastSeenAt).toBeInstanceOf(Date);
    const audit = await getDb().select().from(auditLog);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorAccountId: account.id,
      action: "auth.sign_in",
      entity: "account",
      entityId: account.id,
    });
  });

  it("matches the email without regard to case", async () => {
    await createTestAccount();

    const result = await signIn({ ...base, email: "ADA@Example.COM", password: TEST_PASSWORD });

    expect(result.account.email).toBe("ada@example.com");
  });

  it("gives wrong password, unknown email and deactivated account the same error", async () => {
    const account = await createTestAccount({ email: "ada@example.com" });
    await createTestAccount({ email: "off@example.com", disabled: true });

    const wrong = await failure(
      signIn({ ...base, email: "ada@example.com", password: "wrong password!" }),
    );
    const unknown = await failure(
      signIn({ ...base, email: "nobody@example.com", password: TEST_PASSWORD }),
    );
    const disabled = await failure(
      signIn({ ...base, email: "off@example.com", password: TEST_PASSWORD }),
    );

    for (const error of [unknown, disabled]) {
      expect(error.status).toBe(wrong.status);
      expect(error.code).toBe(wrong.code);
      expect(error.detail).toBe(wrong.detail);
    }
    expect(wrong.status).toBe(401);
    expect(wrong.code).toBe("unauthenticated");

    const audit = await getDb().select().from(auditLog).orderBy(auditLog.id);
    expect(audit.map((row) => row.action)).toEqual(Array(3).fill("auth.sign_in_failed"));
    expect(audit.map((row) => row.actorAccountId)).toEqual([null, null, null]);
    expect(audit.map((row) => (row.data as { reason: string }).reason)).toEqual([
      "bad_credentials",
      "bad_credentials",
      "disabled",
    ]);
    expect(audit[0]?.entityId).toBe(account.id);
    expect(audit[1]?.entityId).toBeNull();
    expect(JSON.stringify(audit)).not.toContain("example.com");
    expect(await getDb().select().from(sessions)).toHaveLength(0);
  });

  it("refuses the 11th attempt for one email with 429 and Retry-After, and audits it", async () => {
    await createTestAccount();
    await createTestAccount({ email: "other@example.com" });
    for (let i = 0; i < 10; i++) {
      await failure(signIn({ ...base, email: "ada@example.com", password: "wrong password!" }));
    }

    const limited = await failure(
      signIn({ ...base, email: "ada@example.com", password: TEST_PASSWORD }),
    );

    expect(limited.status).toBe(429);
    expect(limited.code).toBe("rate_limited");
    expect(limited.retryAfterSeconds).toBeGreaterThan(0);
    const audit = await getDb().select().from(auditLog).orderBy(auditLog.id);
    expect(audit.at(-1)?.data).toMatchObject({ reason: "rate_limited" });

    const other = await signIn({ ...base, email: "other@example.com", password: TEST_PASSWORD });
    expect(other.account.email).toBe("other@example.com");
  });

  it("audits a refusal by the limiter once per window, however often it is repeated", async () => {
    await createTestAccount();
    for (let i = 0; i < 10; i++) {
      await failure(signIn({ ...base, email: "ada@example.com", password: "wrong password!" }));
    }

    const refusals: ApiError[] = [];
    for (let i = 0; i < 10; i++) {
      refusals.push(
        await failure(signIn({ ...base, email: "ada@example.com", password: TEST_PASSWORD })),
      );
    }

    expect(refusals.map((error) => error.status)).toEqual(Array(10).fill(429));
    const audit = await getDb().select().from(auditLog);
    const reasons = audit.map((row) => (row.data as { reason: string }).reason);
    expect(reasons.filter((reason) => reason === "rate_limited")).toHaveLength(1);
    expect(audit).toHaveLength(11);
  });

  describe("trusted, after the caller has just set the password", () => {
    async function exhaust(email: string): Promise<void> {
      for (let i = 0; i < 11; i++) {
        await failure(signIn({ ...base, email, password: "wrong password!" }));
      }
    }

    it("signs in, sets last_seen_at and audits it while the limiter refuses the email", async () => {
      const account = await createTestAccount();
      await exhaust("ada@example.com");

      const result = await signIn(
        { ...base, email: "ada@example.com", password: TEST_PASSWORD },
        undefined,
        { trusted: true },
      );

      expect(result.account.id).toBe(account.id);
      expect(result.headers.getSetCookie().length).toBeGreaterThan(0);
      const [row] = await getDb().select().from(accounts).where(eq(accounts.id, account.id));
      expect(row?.lastSeenAt).toBeInstanceOf(Date);
      const audit = await getDb().select().from(auditLog).orderBy(auditLog.id);
      expect(audit.at(-1)).toMatchObject({ action: "auth.sign_in", actorAccountId: account.id });
    });

    it("neither consumes nor resets the counters, so ordinary sign-ins stay refused", async () => {
      await createTestAccount();
      await exhaust("ada@example.com");
      const counters = await getDb().select().from(rateLimits).orderBy(rateLimits.key);

      await signIn(
        { ...base, clientIp: "203.0.113.7", email: "ada@example.com", password: TEST_PASSWORD },
        undefined,
        { trusted: true },
      );

      expect(await getDb().select().from(rateLimits).orderBy(rateLimits.key)).toEqual(counters);
      const refused = await failure(
        signIn({ ...base, email: "ada@example.com", password: TEST_PASSWORD }),
      );
      expect(refused.status).toBe(429);
    });

    it("still verifies the password", async () => {
      await createTestAccount();

      const wrong = await failure(
        signIn({ ...base, email: "ada@example.com", password: "wrong password!" }, undefined, {
          trusted: true,
        }),
      );

      expect(wrong.status).toBe(401);
    });
  });

  describe("with the failure audit budget used up", () => {
    const failureAuditRule = { max: 5, windowSeconds: 900 };

    async function failTwelveTimes(): Promise<ApiError[]> {
      const errors: ApiError[] = [];
      for (let i = 0; i < 12; i++) {
        errors.push(
          await failure(
            signIn(
              { ...base, email: `nobody${String(i)}@example.com`, password: "wrong password!" },
              getDb(),
              { failureAuditRule },
            ),
          ),
        );
      }
      return errors;
    }

    it("writes no more failure rows than the budget, and marks the last one", async () => {
      await failTwelveTimes();

      const audit = await getDb().select().from(auditLog).orderBy(auditLog.id);
      expect(audit.map((row) => row.action)).toEqual(Array(5).fill("auth.sign_in_failed"));
      expect(audit.map((row) => row.data)).toEqual([
        { reason: "bad_credentials" },
        { reason: "bad_credentials" },
        { reason: "bad_credentials" },
        { reason: "bad_credentials" },
        { reason: "bad_credentials", moreSuppressed: true },
      ]);
    });

    it("answers a suppressed failure exactly like an audited one", async () => {
      const errors = await failTwelveTimes();
      const first = errors[0];

      for (const error of [errors[5], errors[11]]) {
        expect(error?.status).toBe(first?.status);
        expect(error?.code).toBe(first?.code);
        expect(error?.title).toBe(first?.title);
        expect(error?.detail).toBe(first?.detail);
        expect(error?.retryAfterSeconds).toBe(first?.retryAfterSeconds);
      }
      expect(first?.status).toBe(401);
    });

    it("still refuses by the limiter, without a row, when the budget is used up", async () => {
      await failTwelveTimes();
      await createTestAccount();
      const attempt = () =>
        failure(
          signIn({ ...base, email: "ada@example.com", password: "wrong password!" }, getDb(), {
            failureAuditRule,
          }),
        );
      for (let i = 0; i < 10; i++) await attempt();

      const limited = await attempt();

      expect(limited.status).toBe(429);
      expect(limited.retryAfterSeconds).toBeGreaterThan(0);
      expect(await getDb().select().from(auditLog)).toHaveLength(5);
    });

    it("never suppresses a successful sign-in or a sign-out", async () => {
      await failTwelveTimes();
      const account = await createTestAccount();

      const signedIn = await signIn(
        { ...base, email: "ada@example.com", password: TEST_PASSWORD },
        getDb(),
        { failureAuditRule },
      );
      const [session] = await getDb().select().from(sessions);
      await signOut({
        actor: testActor(account),
        sessionId: session?.id ?? "",
        headers: new Headers({ Cookie: cookieHeaderFrom(signedIn.headers) }),
      });

      const audit = await getDb().select().from(auditLog).orderBy(auditLog.id);
      expect(audit.slice(5).map((row) => row.action)).toEqual(["auth.sign_in", "auth.sign_out"]);
      expect(audit.slice(5).map((row) => row.actorAccountId)).toEqual([account.id, account.id]);
    });
  });

  it("refuses the 51st attempt from one address, whatever the email", async () => {
    const clientIp = "203.0.113.7";
    for (let i = 0; i < 50; i++) {
      await failure(
        signIn({ ...base, clientIp, email: `u${String(i)}@example.com`, password: "x" }),
      );
    }

    const limited = await failure(
      signIn({ ...base, clientIp, email: "u99@example.com", password: "x" }),
    );

    expect(limited.status).toBe(429);
  }, 60_000);

  it("stays blocked for a deactivated account turned active again only through a fresh window", async () => {
    const account = await createTestAccount();
    await setDisabled(account.id, true);
    await failure(signIn({ ...base, email: "ada@example.com", password: TEST_PASSWORD }));
    await setDisabled(account.id, false);

    const result = await signIn({ ...base, email: "ada@example.com", password: TEST_PASSWORD });

    expect(result.account.id).toBe(account.id);
  });
});

describe("signInAfterCommit (WS-057)", () => {
  const summary = (id: string) => ({
    id,
    kind: "human" as const,
    name: "Ada",
    email: "ada@example.com",
    role: "member",
  });

  it("signs in and says so when the sign-in works", async () => {
    const account = await createTestAccount();

    const result = await signInAfterCommit(
      { ...base, email: "ada@example.com", password: TEST_PASSWORD },
      summary(account.id),
      getDb(),
    );

    expect(result.signedIn).toBe(true);
    expect(result.account.id).toBe(account.id);
    expect(result.headers.getSetCookie().length).toBeGreaterThan(0);
  });

  it.each([
    ["a busy hash gate", () => serverBusy()],
    ["an unexpected error", () => new Error("SENTINEL-c0ffee secret detail")],
  ])(
    "answers signedIn: false with no cookie for %s, logging one line without its message",
    async (_case, makeError) => {
      const account = await createTestAccount();
      const logError = vi.fn<(message: string) => void>();

      const result = await signInAfterCommit(
        { ...base, email: "ada@example.com", password: TEST_PASSWORD },
        summary(account.id),
        getDb(),
        { logError, signIn: () => Promise.reject(makeError()) },
      );

      expect(result).toEqual({
        account: summary(account.id),
        headers: new Headers(),
        signedIn: false,
      });
      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError.mock.calls[0]?.[0]).not.toContain("SENTINEL");
      expect(await getDb().select().from(sessions)).toHaveLength(0);
    },
  );
});

describe("a session and its audit entry stand or fall together (WS-058)", () => {
  const input = { ...base, email: "ada@example.com", password: TEST_PASSWORD };
  const NEW_PASSWORD = "a brand new password 123";

  function causeOf(error: unknown): string {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : String(error);
  }

  async function sessionsOf(accountId: string) {
    return getDb().select().from(sessions).where(eq(sessions.accountId, accountId));
  }

  it("signIn: when the auth.sign_in write fails, it throws and leaves no session and no last_seen_at", async () => {
    const account = await createTestAccount();
    const restore = await failAuditFor("auth.sign_in");

    let thrown: unknown;
    try {
      await signIn(input);
    } catch (error) {
      thrown = error;
    } finally {
      await restore();
    }

    expect(causeOf(thrown)).toContain("audit write failed");
    expect(await sessionsOf(account.id)).toEqual([]);
    const [row] = await getDb().select().from(accounts).where(eq(accounts.id, account.id));
    expect(row?.lastSeenAt).toBeNull();
  });

  it("signIn: when removing that session fails too, it throws the first error and logs once, without messages", async () => {
    const account = await createTestAccount();
    const restoreAudit = await failAuditFor("auth.sign_in");
    const restoreDelete = await failSessionDeletes();
    const logError = vi.fn<(message: string) => void>();

    let thrown: unknown;
    try {
      await signIn(input, getDb(), { logError });
    } catch (error) {
      thrown = error;
    } finally {
      await restoreDelete();
      await restoreAudit();
    }

    expect(causeOf(thrown)).toContain("audit write failed");
    expect(logError).toHaveBeenCalledTimes(1);
    const [line] = logError.mock.calls[0] ?? [""];
    expect(line).toContain("A session may remain");
    expect(line).not.toContain("audit write failed");
    expect(line).not.toContain("session delete failed");
    expect(await sessionsOf(account.id)).toHaveLength(1);
  });

  it("signIn: refused with 401 when a password change commits while it is in flight; no session survives", async () => {
    const account = await createTestAccount();
    const newHash = await hashPassword(NEW_PASSWORD);
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = (): void => undefined;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });

    // What accepting a reset link does, held open under the account lock.
    const change = getDb().transaction(async (tx) => {
      await lockAccount(tx, account.id);
      await tx
        .update(credentials)
        .set({ passwordHash: newHash, updatedAt: new Date() })
        .where(eq(credentials.accountId, account.id));
      await tx.delete(sessions).where(eq(sessions.accountId, account.id));
      locked();
      await held;
    });
    await isLocked;

    const attempt = failure(signIn(input));
    try {
      await waitForAdvisoryLockWaiter();
    } finally {
      release();
      await change;
    }
    const error = await attempt;

    expect(error.status).toBe(401);
    expect(await sessionsOf(account.id)).toEqual([]);
    const actions = (await getDb().select().from(auditLog)).map((row) => row.action);
    expect(actions).toContain("auth.sign_in_failed");
    expect(actions).not.toContain("auth.sign_in");
  });

  it("signIn: a session made before a password change is ended by that change", async () => {
    const account = await createTestAccount();
    const first = await signIn(input);
    const current = await authenticateSession(
      new Request(`${APP_ORIGIN}/api/v1/me`, {
        headers: { Cookie: cookieHeaderFrom(first.headers) },
      }),
    );
    const other = await signIn(input);

    await changeOwnPassword(testActor(account), {
      sessionId: current.sessionId,
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    const left = await sessionsOf(account.id);
    expect(left.map((row) => row.id)).toEqual([current.sessionId]);
    await expect(
      authenticateSession(
        new Request(`${APP_ORIGIN}/api/v1/me`, {
          headers: { Cookie: cookieHeaderFrom(other.headers) },
        }),
      ),
    ).rejects.toThrow();
  });

  it("signOut: when the auth.sign_out write fails, it throws and the session still works", async () => {
    const account = await createTestAccount();
    const signedIn = await signIn(input);
    const cookie = cookieHeaderFrom(signedIn.headers);
    const request = () => new Request(`${APP_ORIGIN}/api/v1/me`, { headers: { Cookie: cookie } });
    const { sessionId } = await authenticateSession(request());
    const restore = await failAuditFor("auth.sign_out");

    try {
      await expect(
        signOut({ actor: testActor(account), sessionId, headers: new Headers({ Cookie: cookie }) }),
      ).rejects.toThrow();
    } finally {
      await restore();
    }

    expect(await sessionsOf(account.id)).toHaveLength(1);
    expect((await authenticateSession(request())).sessionId).toBe(sessionId);
  });

  it("signOut: deletes the session row, audits it, and clears the cookie", async () => {
    const account = await createTestAccount();
    const signedIn = await signIn(input);
    const cookie = cookieHeaderFrom(signedIn.headers);
    const { sessionId } = await authenticateSession(
      new Request(`${APP_ORIGIN}/api/v1/me`, { headers: { Cookie: cookie } }),
    );

    const headers = await signOut({
      actor: testActor(account),
      sessionId,
      headers: new Headers({ Cookie: cookie }),
    });

    expect(await sessionsOf(account.id)).toEqual([]);
    expect(headers.getSetCookie().join(";")).toMatch(/Max-Age=0|Expires=/i);
    const actions = (await getDb().select().from(auditLog)).map((row) => row.action);
    expect(actions.at(-1)).toBe("auth.sign_out");
  });
});
