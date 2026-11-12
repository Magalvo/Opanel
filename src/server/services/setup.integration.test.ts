import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestAccount, TEST_PASSWORD } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { accounts, auditLog, credentials } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { createFirstAdmin, isSetupNeeded } from "./setup";

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
