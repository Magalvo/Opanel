import { desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  createTestAccount,
  failAuditFor,
  signInCookie,
  TEST_PASSWORD,
  testActor,
} from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { accounts, accountTokens, auditLog, sessions } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { inviteAccount, issueResetLink, listAccounts, updateAccount } from "./account-management";
import { hashToken } from "./account-tokens";
import { signIn } from "./sign-in";

async function admin(email = "admin@example.com") {
  const account = await createTestAccount({ email, role: "admin" });
  return { account, actor: testActor(account) };
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

function tokenOf(link: { url: string }): string {
  return new URL(link.url).hash.slice(1);
}

async function auditActions(): Promise<string[]> {
  const rows = await getDb().select().from(auditLog).orderBy(auditLog.id);
  return rows.map((row) => row.action);
}

describe("permissions", () => {
  it("every service function refuses an actor without accounts:manage", async () => {
    const target = await createTestAccount({ email: "t@example.com" });
    for (const role of ["viewer", "member", "manager"] as const) {
      const account = await createTestAccount({ email: `${role}@example.com`, role });
      const actor = testActor(account);

      expect((await failure(listAccounts(actor, { limit: 50 }))).status).toBe(403);
      expect(
        (await failure(inviteAccount(actor, { name: "X", email: "x@example.com", role: "member" })))
          .status,
      ).toBe(403);
      expect((await failure(updateAccount(actor, target.id, { role: "viewer" }))).status).toBe(403);
      expect((await failure(issueResetLink(actor, target.id))).status).toBe(403);
    }
    expect(await getDb().select().from(accountTokens)).toHaveLength(0);
  });
});

describe("listAccounts", () => {
  it("lists humans only, with a derived status, in creation order", async () => {
    const { actor } = await admin();
    await createTestAccount({ email: "active@example.com" });
    await createTestAccount({ email: "off@example.com", disabled: true });
    await getDb()
      .insert(accounts)
      .values({ kind: "human", name: "Invited", email: "invited@example.com", role: "member" });
    await getDb()
      .insert(accounts)
      .values({ kind: "agent", name: "bot", email: null, role: "qa_agent" });

    const page = await listAccounts(actor, { limit: 50 });

    expect(page.nextCursor).toBeNull();
    expect(page.items.map((item) => [item.email, item.status])).toEqual([
      ["admin@example.com", "active"],
      ["active@example.com", "active"],
      ["off@example.com", "deactivated"],
      ["invited@example.com", "invited"],
    ]);
    expect(page.items[0]).toMatchObject({ role: "admin", lastSeenAt: null });
    expect(page.items[0]?.createdAt).toMatch(/Z$/);
  });

  it("pages with a keyset cursor: no repeat, no gap, ties broken by id, new rows do not disturb", async () => {
    const { actor } = await admin("a0@example.com");
    const tied = new Date("2030-01-01T00:00:00.000Z");
    for (let i = 1; i <= 4; i++) {
      await getDb()
        .insert(accounts)
        .values({
          kind: "human",
          name: `U${String(i)}`,
          email: `u${String(i)}@example.com`,
          role: "member",
          createdAt: i <= 3 ? tied : new Date("2030-01-02T00:00:00.000Z"),
        });
    }

    const first = await listAccounts(actor, { limit: 2 });
    await getDb()
      .insert(accounts)
      .values({
        kind: "human",
        name: "Late",
        email: "late@example.com",
        role: "member",
        createdAt: new Date("2030-06-01T00:00:00.000Z"),
      });
    const second = await listAccounts(actor, { limit: 2, cursor: first.nextCursor ?? "" });
    const third = await listAccounts(actor, { limit: 2, cursor: second.nextCursor ?? "" });

    const emails = [...first.items, ...second.items, ...third.items].map((item) => item.email);
    expect(new Set(emails).size).toBe(emails.length);
    expect(emails).toEqual(
      expect.arrayContaining([
        "a0@example.com",
        "u1@example.com",
        "u2@example.com",
        "u3@example.com",
        "u4@example.com",
        "late@example.com",
      ]),
    );
    expect(emails).toHaveLength(6);
    expect(first.nextCursor).not.toBeNull();
    expect(third.nextCursor).toBeNull();
    // the three rows that share a timestamp come out in id order
    const tiedIds = emails
      .filter((email) => /^u[123]@/.test(email))
      .map(
        (email) =>
          [...first.items, ...second.items, ...third.items].find((item) => item.email === email)
            ?.id ?? "",
      );
    expect(tiedIds).toEqual([...tiedIds].sort());
  });

  it("answers 400 for a tampered cursor", async () => {
    const { actor } = await admin();

    expect((await failure(listAccounts(actor, { limit: 10, cursor: "garbage" }))).status).toBe(400);
  });
});

describe("inviteAccount", () => {
  it("creates an account with no password and a link that matches the stored hash, and audits it", async () => {
    const { account, actor } = await admin();

    const result = await inviteAccount(actor, {
      name: " Grace ",
      email: "Grace@Example.com",
      role: "manager",
    });

    expect(result.account).toMatchObject({
      name: "Grace",
      email: "grace@example.com",
      role: "manager",
      status: "invited",
    });
    expect(result.link.url.startsWith("http://localhost:3000/accept#")).toBe(true);
    const [row] = await getDb().select().from(accounts).where(eq(accounts.id, result.account.id));
    expect(row?.createdBy).toBe(account.id);
    const [stored] = await getDb().select().from(accountTokens);
    expect(stored).toMatchObject({
      accountId: result.account.id,
      kind: "invitation",
      createdBy: account.id,
    });
    expect(stored?.tokenHash).toBe(hashToken(tokenOf(result.link)));
    const audit = await getDb().select().from(auditLog).orderBy(desc(auditLog.id)).limit(1);
    expect(audit[0]).toMatchObject({
      actorAccountId: account.id,
      action: "account.invited",
      entityId: result.account.id,
      data: { role: "manager" },
    });
    expect(JSON.stringify(audit)).not.toContain(tokenOf(result.link));
  });

  it("leaves nothing behind when the audit write fails", async () => {
    const { actor } = await admin();
    const restore = await failAuditFor("account.invited");
    try {
      await expect(
        inviteAccount(actor, { name: "G", email: "g@example.com", role: "member" }),
      ).rejects.toThrow();
    } finally {
      await restore();
    }

    expect(await getDb().select().from(accounts)).toHaveLength(1);
    expect(await getDb().select().from(accountTokens)).toHaveLength(0);
  });

  it("answers 409 for a duplicate email, whatever its case, and writes nothing", async () => {
    const { actor } = await admin();
    await createTestAccount({ email: "taken@example.com" });
    const before = (await auditActions()).length;

    const error = await failure(
      inviteAccount(actor, { name: "X", email: "TAKEN@example.com", role: "member" }),
    );

    expect(error.status).toBe(409);
    expect(await getDb().select().from(accountTokens)).toHaveLength(0);
    expect((await auditActions()).length).toBe(before);
  });
});

describe("updateAccount: role", () => {
  it("changes the role, audits from and to, and ends the account's sessions", async () => {
    const { account: a, actor } = await admin();
    const member = await createTestAccount({ email: "m@example.com", role: "member" });
    await signInCookie("m@example.com");
    expect(
      await getDb().select().from(sessions).where(eq(sessions.accountId, member.id)),
    ).toHaveLength(1);

    const updated = await updateAccount(actor, member.id, { role: "manager" });

    expect(updated.role).toBe("manager");
    expect(
      await getDb().select().from(sessions).where(eq(sessions.accountId, member.id)),
    ).toHaveLength(0);
    const audit = await getDb().select().from(auditLog).orderBy(desc(auditLog.id)).limit(1);
    expect(audit[0]).toMatchObject({
      actorAccountId: a.id,
      action: "account.role_changed",
      entityId: member.id,
      data: { from: "member", to: "manager" },
    });
  });

  it("is a no-op for the same role: no audit entry and sessions are kept", async () => {
    const { actor } = await admin();
    const member = await createTestAccount({ email: "m@example.com", role: "member" });
    await signInCookie("m@example.com");
    const before = (await auditActions()).length;

    const updated = await updateAccount(actor, member.id, { role: "member" });

    expect(updated.role).toBe("member");
    expect((await auditActions()).length).toBe(before);
    expect(
      await getDb().select().from(sessions).where(eq(sessions.accountId, member.id)),
    ).toHaveLength(1);
  });
});

describe("updateAccount: deactivate and reactivate", () => {
  it("deactivates: sets disabled_at, ends sessions, deletes unused links, audits; sign-in then fails and works again after reactivation", async () => {
    const { actor } = await admin();
    const invited = await inviteAccount(actor, {
      name: "G",
      email: "g@example.com",
      role: "member",
    });
    const member = await createTestAccount({ email: "m@example.com" });
    await signInCookie("m@example.com");
    await issueResetLink(actor, member.id);

    const off = await updateAccount(actor, member.id, { active: false });

    expect(off.status).toBe("deactivated");
    expect(
      await getDb().select().from(sessions).where(eq(sessions.accountId, member.id)),
    ).toHaveLength(0);
    const links = await getDb().select().from(accountTokens);
    expect(links.map((link) => link.accountId)).toEqual([invited.account.id]);
    expect(await auditActions()).toContain("account.deactivated");
    const signInInput = {
      email: "m@example.com",
      password: TEST_PASSWORD,
      clientIp: null,
      headers: new Headers(),
    };
    expect((await failure(signIn(signInInput))).status).toBe(401);

    const on = await updateAccount(actor, member.id, { active: true });

    expect(on.status).toBe("active");
    expect(await auditActions()).toContain("account.reactivated");
    expect((await signIn(signInInput)).account.id).toBe(member.id);
  });

  it("is a no-op when the account is already in the asked state", async () => {
    const { actor } = await admin();
    const member = await createTestAccount({ email: "m@example.com" });
    const before = (await auditActions()).length;

    await updateAccount(actor, member.id, { active: true });

    expect((await auditActions()).length).toBe(before);
  });
});

describe("updateAccount: the last active Admin", () => {
  it("cannot be demoted or deactivated, by themselves or by another Admin who is the same person", async () => {
    const { account, actor } = await admin();

    for (const change of [
      { role: "member" as const },
      { active: false },
      { role: "viewer" as const, active: false },
    ]) {
      const error = await failure(updateAccount(actor, account.id, change));
      expect(error.status).toBe(409);
      expect(error.code).toBe("last_admin");
    }
    const [row] = await getDb().select().from(accounts).where(eq(accounts.id, account.id));
    expect(row).toMatchObject({ role: "admin", disabledAt: null });
  });

  it("can be changed once a second active Admin exists, but a deactivated Admin does not count", async () => {
    const { account: first, actor } = await admin("a@example.com");
    const second = await createTestAccount({ email: "b@example.com", role: "admin" });
    await updateAccount(actor, second.id, { active: false });

    expect((await failure(updateAccount(actor, first.id, { role: "member" }))).code).toBe(
      "last_admin",
    );

    await updateAccount(actor, second.id, { active: true });
    expect((await updateAccount(actor, first.id, { role: "member" })).role).toBe("member");
  });

  it("is not blocked for a Member: demoting a non-Admin never trips the rule", async () => {
    const { actor } = await admin();
    const member = await createTestAccount({ email: "m@example.com" });

    expect((await updateAccount(actor, member.id, { active: false })).status).toBe("deactivated");
  });

  it("lets exactly one of two Admins who demote each other at the same moment succeed", async () => {
    const a = await createTestAccount({ email: "a@example.com", role: "admin" });
    const b = await createTestAccount({ email: "b@example.com", role: "admin" });

    const results = await Promise.allSettled([
      updateAccount(testActor(a), b.id, { role: "member" }),
      updateAccount(testActor(b), a.id, { role: "member" }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect((rejected?.reason as ApiError).code).toBe("last_admin");
    const admins = await getDb().select().from(accounts).where(eq(accounts.role, "admin"));
    expect(admins).toHaveLength(1);
  });
});

describe("issueResetLink", () => {
  it("gives an invitation link to an invited account, a reset link to an active one, and replaces earlier links", async () => {
    const { actor } = await admin();
    const invited = await inviteAccount(actor, {
      name: "G",
      email: "g@example.com",
      role: "member",
    });
    const member = await createTestAccount({ email: "m@example.com" });

    const again = await issueResetLink(actor, invited.account.id);
    const reset = await issueResetLink(actor, member.id);

    const rows = await getDb().select().from(accountTokens);
    expect(rows.map((row) => [row.accountId, row.kind]).sort()).toEqual(
      [
        [invited.account.id, "invitation"],
        [member.id, "reset"],
      ].sort(),
    );
    expect(rows.map((row) => row.tokenHash)).not.toContain(hashToken(tokenOf(invited.link)));
    expect(rows.map((row) => row.tokenHash)).toContain(hashToken(tokenOf(again.link)));
    expect(rows.map((row) => row.tokenHash)).toContain(hashToken(tokenOf(reset.link)));
    const audit = await getDb().select().from(auditLog).orderBy(desc(auditLog.id)).limit(2);
    expect(audit.map((row) => row.data)).toEqual([{ kind: "reset" }, { kind: "invitation" }]);
    expect(JSON.stringify(audit)).not.toContain(tokenOf(reset.link));
  });

  it("answers 409 for a deactivated account", async () => {
    const { actor } = await admin();
    const off = await createTestAccount({ email: "off@example.com", disabled: true });

    expect((await failure(issueResetLink(actor, off.id))).status).toBe(409);
    expect(await getDb().select().from(accountTokens)).toHaveLength(0);
  });
});

describe("unknown ids and agents", () => {
  it("are a 404 for update and reset link", async () => {
    const { actor } = await admin();
    const [agent] = await getDb()
      .insert(accounts)
      .values({ kind: "agent", name: "bot", email: null, role: "qa_agent" })
      .returning();
    const ids = [crypto.randomUUID(), agent?.id ?? ""];

    for (const id of ids) {
      expect((await failure(updateAccount(actor, id, { active: false }))).status).toBe(404);
      expect((await failure(issueResetLink(actor, id))).status).toBe(404);
    }
  });
});
