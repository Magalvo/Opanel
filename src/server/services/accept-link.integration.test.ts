import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { authenticate } from "@/server/auth/authenticate";
import {
  cookieHeaderFrom,
  createTestAccount,
  failAuditFor,
  setDisabled,
  signInCookie,
  TEST_PASSWORD,
  testActor,
} from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import {
  accounts,
  accountTokens,
  auditLog,
  credentials,
  rateLimits,
  sessions,
} from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { acceptLink } from "./accept-link";
import { inviteAccount, issueResetLink } from "./account-management";
import { hashToken } from "./account-tokens";
import { signIn } from "./sign-in";

const NEW_PASSWORD = "a brand new password 123";

function tokenOf(link: { url: string }): string {
  return new URL(link.url).hash.slice(1);
}

function accept(token: string, overrides: { password?: string; clientIp?: string | null } = {}) {
  return acceptLink({
    token,
    password: overrides.password ?? NEW_PASSWORD,
    clientIp: overrides.clientIp ?? null,
    headers: new Headers(),
  });
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected a failure");
}

async function admin() {
  const account = await createTestAccount({ email: "admin@example.com", role: "admin" });
  return { account, actor: testActor(account) };
}

async function invited(email = "grace@example.com") {
  const { actor } = await admin();
  const result = await inviteAccount(actor, { name: "Grace", email, role: "member" });
  return { actor, account: result.account, token: tokenOf(result.link) };
}

async function auditRows() {
  return getDb().select().from(auditLog).orderBy(auditLog.id);
}

describe("accepting an invitation", () => {
  it("sets the first password, marks the link used and signs the person in", async () => {
    const { account, token } = await invited();

    const result = await accept(token);

    expect(result.account).toMatchObject({
      id: account.id,
      email: "grace@example.com",
      role: "member",
    });
    const [credential] = await getDb()
      .select()
      .from(credentials)
      .where(eq(credentials.accountId, account.id));
    expect(credential?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(credential?.passwordHash).not.toContain(NEW_PASSWORD);
    const [link] = await getDb().select().from(accountTokens);
    expect(link?.usedAt).toBeInstanceOf(Date);
    const session = await authenticate(
      new Request("http://localhost:3000/api/v1/me", {
        headers: { Cookie: cookieHeaderFrom(result.headers) },
      }),
    );
    expect(session.actor.accountId).toBe(account.id);
    expect(
      (
        await signIn({
          email: "grace@example.com",
          password: NEW_PASSWORD,
          clientIp: null,
          headers: new Headers(),
        })
      ).account.id,
    ).toBe(account.id);
  });

  it("audits it with the account as actor, then the sign-in, and records no secret", async () => {
    const { account, token } = await invited();

    await accept(token);

    const rows = await auditRows();
    expect(rows.slice(-2).map((row) => row.action)).toEqual([
      "account.invitation_accepted",
      "auth.sign_in",
    ]);
    expect(rows.slice(-2).map((row) => row.actorAccountId)).toEqual([account.id, account.id]);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(JSON.stringify(rows)).not.toContain(NEW_PASSWORD);
  });
});

describe("accepting a reset link", () => {
  it("replaces the password and leaves the new session as the only one", async () => {
    const { actor } = await admin();
    const member = await createTestAccount({ email: "m@example.com" });
    await signInCookie("m@example.com");
    await signInCookie("m@example.com");
    expect(
      await getDb().select().from(sessions).where(eq(sessions.accountId, member.id)),
    ).toHaveLength(2);
    const { link } = await issueResetLink(actor, member.id);

    const result = await accept(tokenOf(link));

    const remaining = await getDb()
      .select()
      .from(sessions)
      .where(eq(sessions.accountId, member.id));
    expect(remaining).toHaveLength(1);
    expect(cookieHeaderFrom(result.headers)).toContain(
      remaining[0]?.token.split(".")[0] ?? "no-token",
    );
    const old = await failure(
      signIn({
        email: "m@example.com",
        password: TEST_PASSWORD,
        clientIp: null,
        headers: new Headers(),
      }),
    );
    expect(old.status).toBe(401);
    expect(
      (
        await signIn({
          email: "m@example.com",
          password: NEW_PASSWORD,
          clientIp: null,
          headers: new Headers(),
        })
      ).account.id,
    ).toBe(member.id);
  });

  it("audits password_changed via a reset link, with the account as actor", async () => {
    const { actor } = await admin();
    const member = await createTestAccount({ email: "m@example.com" });
    const { link } = await issueResetLink(actor, member.id);

    await accept(tokenOf(link));

    const rows = await auditRows();
    expect(rows.slice(-2).map((row) => row.action)).toEqual([
      "account.password_changed",
      "auth.sign_in",
    ]);
    expect(rows.at(-2)).toMatchObject({
      actorAccountId: member.id,
      entityId: member.id,
      data: { via: "reset_link" },
    });
    expect(JSON.stringify(rows)).not.toContain(tokenOf(link));
  });
});

describe("a link that does not work", () => {
  it("is the same 404 invalid_link for unknown, used, expired, replaced and deactivated, and writes no audit row", async () => {
    const { actor } = await admin();
    const grace = await inviteAccount(actor, {
      name: "Grace",
      email: "grace@example.com",
      role: "member",
    });
    const deactivated = tokenOf(grace.link);
    // Deactivated directly, so that its link is still stored: the link itself must be refused.
    await setDisabled(grace.account.id, true);
    const member = await createTestAccount({ email: "m@example.com" });
    const used = tokenOf((await issueResetLink(actor, member.id)).link);
    await accept(used);
    const replaced = tokenOf((await issueResetLink(actor, member.id)).link);
    const expired = tokenOf((await issueResetLink(actor, member.id)).link);
    await getDb()
      .update(accountTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(accountTokens.tokenHash, hashToken(expired)));
    const before = (await auditRows()).length;

    const errors = [];
    for (const token of ["x".repeat(43), used, replaced, expired, deactivated]) {
      errors.push(await failure(accept(token)));
    }

    for (const error of errors) {
      expect(error.status).toBe(404);
      expect(error.code).toBe("invalid_link");
      expect(error.detail).toBe(errors[0]?.detail);
    }
    expect((await auditRows()).length).toBe(before);
  });

  it("works for exactly one of five simultaneous requests", async () => {
    const { account, token } = await invited();

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => accept(token)));

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((x) => x.status === "rejected")) {
      expect((r.reason as ApiError).status).toBe(404);
    }
    expect(
      await getDb().select().from(credentials).where(eq(credentials.accountId, account.id)),
    ).toHaveLength(1);
  }, 30_000);

  it("leaves the link usable, the old password and the old sessions alone when the audit write fails", async () => {
    const { actor } = await admin();
    const member = await createTestAccount({ email: "m@example.com" });
    await signInCookie("m@example.com");
    const { link } = await issueResetLink(actor, member.id);
    const restore = await failAuditFor("account.password_changed");
    try {
      await expect(accept(tokenOf(link))).rejects.toThrow();
    } finally {
      await restore();
    }

    const [row] = await getDb()
      .select()
      .from(accountTokens)
      .where(eq(accountTokens.tokenHash, hashToken(tokenOf(link))));
    expect(row?.usedAt).toBeNull();
    expect(
      await getDb().select().from(sessions).where(eq(sessions.accountId, member.id)),
    ).toHaveLength(1);
    expect(
      (
        await signIn({
          email: "m@example.com",
          password: TEST_PASSWORD,
          clientIp: null,
          headers: new Headers(),
        })
      ).account.id,
    ).toBe(member.id);
  });
});

describe("limits and log growth", () => {
  it("writes no audit row and at most one counter for 20 invalid attempts from one address", async () => {
    const before = (await auditRows()).length;

    for (let i = 0; i < 20; i++) {
      await failure(
        accept(`${String(i).padStart(2, "0")}${"y".repeat(41)}`, { clientIp: "203.0.113.9" }),
      );
    }

    expect((await auditRows()).length).toBe(before);
    expect((await getDb().select().from(rateLimits)).length).toBeLessThanOrEqual(1);
  }, 30_000);

  it("refuses the 31st attempt from one address with 429 and still writes no audit row", async () => {
    for (let i = 0; i < 30; i++) {
      await failure(
        accept(`${String(i).padStart(2, "0")}${"z".repeat(41)}`, { clientIp: "203.0.113.10" }),
      );
    }

    const limited = await failure(accept("q".repeat(43), { clientIp: "203.0.113.10" }));

    expect(limited.status).toBe(429);
    expect(limited.retryAfterSeconds).toBeGreaterThan(0);
    expect(await getDb().select().from(auditLog)).toHaveLength(0);
  }, 30_000);

  it("does not limit when no client address is known", async () => {
    for (let i = 0; i < 35; i++) {
      const error = await failure(accept(`${String(i).padStart(2, "0")}${"w".repeat(41)}`));
      expect(error.status).toBe(404);
    }
  }, 30_000);
});

describe("secrets", () => {
  it("keeps the password and the token out of the logs", async () => {
    const { token } = await invited();
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      }),
    );

    await accept(token, { password: "Marker-Password-77aa-31c0" });
    spies.forEach((spy) => {
      spy.mockRestore();
    });

    expect(logged.join("\n")).not.toContain("Marker-Password-77aa-31c0");
    expect(logged.join("\n")).not.toContain(token);
    expect((await getDb().select().from(accounts)).length).toBeGreaterThan(0);
  });
});
