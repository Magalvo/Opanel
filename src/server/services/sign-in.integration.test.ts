import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  cookieHeaderFrom,
  createTestAccount,
  setDisabled,
  TEST_PASSWORD,
  testActor,
} from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { accounts, auditLog, sessions } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { signIn, signOut } from "./sign-in";

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
      await signOut({
        actor: testActor(account),
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
