import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { ApiError } from "@/server/http/errors";
import { createTestAccount, setDisabled, TEST_PASSWORD } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { accounts, auditLog, sessions } from "@/server/db/schema";

import { signIn } from "./sign-in";

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
