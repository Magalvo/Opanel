import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Password from "@/server/auth/password";
import { hashPassword } from "@/server/auth/password";
import { createTestAccount, TEST_PASSWORD } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { accounts, auditLog, credentials } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { createFirstAdmin, isSetupNeeded, isSetupTokenRequired } from "./setup";
import { signIn } from "./sign-in";

// The real hash, observed (WS-043): the spy calls through, so every test hashes for real.
vi.mock("@/server/auth/password", async (importOriginal) => {
  const actual = await importOriginal<typeof Password>();
  return { ...actual, hashPassword: vi.fn(actual.hashPassword) };
});

const realPassword = await vi.importActual<typeof Password>("@/server/auth/password");
const hashSpy = vi.mocked(hashPassword);

const input = {
  name: "  Ada Admin ",
  email: "Ada@Example.com",
  password: TEST_PASSWORD,
  clientIp: null,
  headers: new Headers(),
};

describe("isSetupNeeded", () => {
  it("is true on an empty install and false once an account exists", async () => {
    expect(await isSetupNeeded()).toBe(true);

    await createTestAccount();

    expect(await isSetupNeeded()).toBe(false);
  });
});

describe("createFirstAdmin", () => {
  it("creates an admin with a lower-cased email, a trimmed name and an Argon2id credential", async () => {
    const result = await createFirstAdmin(input);

    expect(result.account).toMatchObject({
      kind: "human",
      name: "Ada Admin",
      email: "ada@example.com",
      role: "admin",
    });
    expect(result.headers.getSetCookie().length).toBeGreaterThan(0);
    const [credential] = await getDb().select().from(credentials);
    expect(credential?.accountId).toBe(result.account.id);
    expect(credential?.providerId).toBe("credential");
    expect(credential?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(credential?.passwordHash).not.toContain(TEST_PASSWORD);
  });

  it("records the creation with the new account as actor, then the sign-in", async () => {
    const { account } = await createFirstAdmin(input);

    const audit = await getDb().select().from(auditLog).orderBy(auditLog.id);

    expect(audit.map((row) => row.action)).toEqual(["setup.first_admin_created", "auth.sign_in"]);
    expect(audit[0]).toMatchObject({
      actorAccountId: account.id,
      entity: "account",
      entityId: account.id,
    });
  });

  it("signs the new admin in even while the limiter refuses that email", async () => {
    for (let i = 0; i < 11; i++) {
      await signIn({ ...input, password: "wrong password!" }).catch(() => undefined);
    }

    const result = await createFirstAdmin(input);

    expect(result.account.email).toBe("ada@example.com");
    expect(result.headers.getSetCookie().length).toBeGreaterThan(0);
  });

  it("answers 404 and creates nothing when any account exists, even a deactivated one", async () => {
    await createTestAccount({ email: "off@example.com", disabled: true });

    await expect(createFirstAdmin(input)).rejects.toMatchObject({ status: 404 });

    expect(await getDb().select().from(accounts)).toHaveLength(1);
    expect(await getDb().select().from(credentials)).toHaveLength(1);
  });

  it("answers 404 when the only existing account is an agent", async () => {
    await getDb()
      .insert(accounts)
      .values({ kind: "agent", name: "bot", email: null, role: "qa_agent" });

    await expect(createFirstAdmin(input)).rejects.toMatchObject({ status: 404 });
  });

  describe("refuses before hashing once the install has accounts (WS-043)", () => {
    beforeEach(() => {
      hashSpy.mockClear();
    });

    it.each([
      ["an active account", () => createTestAccount({ email: "on@example.com" })],
      [
        "only a deactivated account",
        () => createTestAccount({ email: "off@example.com", disabled: true }),
      ],
      [
        "only an agent",
        () =>
          getDb()
            .insert(accounts)
            .values({ kind: "agent", name: "bot", email: null, role: "qa_agent" }),
      ],
    ])("with %s: 404, nothing hashed, nothing created", async (_case, existing) => {
      await existing();
      const before = await getDb().select().from(accounts);
      hashSpy.mockClear();

      await expect(createFirstAdmin(input)).rejects.toMatchObject({ status: 404 });

      expect(hashSpy).not.toHaveBeenCalled();
      expect(await getDb().select().from(accounts)).toHaveLength(before.length);
    });

    it("hashes exactly once on an empty install", async () => {
      await createFirstAdmin(input);

      expect(hashSpy).toHaveBeenCalledOnce();
    });

    it("lets the check under the lock decide when an account appears while hashing", async () => {
      hashSpy.mockImplementationOnce(async (password) => {
        await getDb()
          .insert(accounts)
          .values({ kind: "human", name: "Other", email: "other@example.com", role: "admin" });
        return realPassword.hashPassword(password);
      });

      await expect(createFirstAdmin(input)).rejects.toMatchObject({ status: 404 });

      expect(await getDb().select().from(accounts)).toHaveLength(1);
      expect(await getDb().select().from(credentials)).toHaveLength(0);
      expect(await getDb().select().from(auditLog)).toHaveLength(0);
    });
  });

  it("lets exactly one of five simultaneous requests win", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        createFirstAdmin({ ...input, email: `admin${String(i)}@example.com` }),
      ),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failures = results.filter((r) => r.status === "rejected");
    expect(failures).toHaveLength(4);
    for (const failure of failures) {
      expect(failure.reason).toBeInstanceOf(ApiError);
      expect((failure.reason as ApiError).status).toBe(404);
    }
    expect(await getDb().select().from(accounts)).toHaveLength(1);
  }, 30_000);

  it("leaves no account and no credential when the audit write fails", async () => {
    await getDb().execute(sql`
      create function fail_setup_audit() returns trigger as $$
      begin raise exception 'audit write failed'; end;
      $$ language plpgsql`);
    await getDb().execute(sql`
      create trigger fail_setup_audit before insert on audit_log
      for each row when (new.action = 'setup.first_admin_created')
      execute function fail_setup_audit()`);
    try {
      await expect(createFirstAdmin(input)).rejects.toThrow();
    } finally {
      await getDb().execute(sql`drop trigger fail_setup_audit on audit_log`);
      await getDb().execute(sql`drop function fail_setup_audit()`);
    }

    expect(await getDb().select().from(accounts)).toHaveLength(0);
    expect(await getDb().select().from(credentials)).toHaveLength(0);
  });
});

describe("the optional setup token (WS-050)", () => {
  const token = "the-setup-token-0123456789abcdef";
  const withToken = { expectedSetupToken: token };

  beforeEach(() => {
    hashSpy.mockClear();
  });

  it.each([
    ["a missing token", undefined],
    ["a wrong token", "the-setup-token-0123456789abcdeX"],
    ["an empty token", ""],
  ])("%s: 403 invalid_setup_token, nothing hashed, nothing written", async (_case, given) => {
    await expect(
      createFirstAdmin({ ...input, setupToken: given }, getDb(), withToken),
    ).rejects.toMatchObject({ status: 403, code: "invalid_setup_token" });

    expect(hashSpy).not.toHaveBeenCalled();
    expect(await getDb().select().from(accounts)).toHaveLength(0);
    expect(await getDb().select().from(credentials)).toHaveLength(0);
    expect(await getDb().select().from(auditLog)).toHaveLength(0);
  });

  it("the right token creates the admin and signs them in", async () => {
    const result = await createFirstAdmin({ ...input, setupToken: token }, getDb(), withToken);

    expect(result.account).toMatchObject({ email: "ada@example.com", role: "admin" });
    expect(result.headers.getSetCookie().length).toBeGreaterThan(0);
  });

  it("an installed server answers 404 before the token is looked at", async () => {
    await createTestAccount();

    await expect(
      createFirstAdmin({ ...input, setupToken: "wrong" }, getDb(), withToken),
    ).rejects.toMatchObject({ status: 404 });
  });

  it.each([
    ["without a token sent", undefined],
    ["with any token sent", "anything at all"],
  ])("with no token configured, setup is unchanged %s", async (_case, given) => {
    const result = await createFirstAdmin({ ...input, setupToken: given }, getDb(), {
      expectedSetupToken: undefined,
    });

    expect(result.account.role).toBe("admin");
  });

  it("isSetupTokenRequired says whether a token is configured", () => {
    expect(isSetupTokenRequired({ SETUP_TOKEN: token })).toBe(true);
    expect(isSetupTokenRequired({ SETUP_TOKEN: undefined })).toBe(false);
  });
});
