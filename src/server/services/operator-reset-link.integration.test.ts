import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestAccount, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { accountTokens, auditLog } from "@/server/db/schema";

import { acceptLink } from "./accept-link";
import { inviteAccount, issueOperatorResetLink, OperatorRefusal } from "./account-management";
import { signIn } from "./sign-in";

const NEW_PASSWORD = "a password the operator never sees";

function tokenOf(url: string): string {
  return new URL(url).hash.slice(1);
}

async function refusalOf(promise: Promise<unknown>): Promise<OperatorRefusal> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OperatorRefusal) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("issueOperatorResetLink (WS-065 section 2)", () => {
  it("gives an active Admin a reset link that sets a new password", async () => {
    const admin = await createTestAccount({ email: "only.admin@example.com", role: "admin" });

    const link = await issueOperatorResetLink("  Only.Admin@example.com ");

    expect(link.url).toMatch(/\/accept#[A-Za-z0-9_-]{43,}$/);
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const [row] = await getDb()
      .select()
      .from(accountTokens)
      .where(eq(accountTokens.accountId, admin.id));
    expect(row).toMatchObject({ kind: "reset", createdBy: admin.id, usedAt: null });

    await acceptLink({
      token: tokenOf(link.url),
      password: NEW_PASSWORD,
      clientIp: null,
      headers: new Headers(),
    });
    const signedIn = await signIn({
      email: "only.admin@example.com",
      password: NEW_PASSWORD,
      clientIp: null,
      headers: new Headers(),
    });
    expect(signedIn.account.id).toBe(admin.id);
  });

  it("records the link with no acting account, via the operator, and no token", async () => {
    const admin = await createTestAccount({ email: "only.admin@example.com", role: "admin" });

    const link = await issueOperatorResetLink("only.admin@example.com");

    const rows = await getDb().select().from(auditLog).where(eq(auditLog.entityId, admin.id));
    expect(rows.map((row) => [row.action, row.actorAccountId, row.data])).toEqual([
      ["account.reset_link_created", null, { kind: "reset", via: "operator" }],
    ]);
    expect(JSON.stringify(rows)).not.toContain(tokenOf(link.url));
  });

  it("gives an invited Admin an invitation link, and the earlier one stops working", async () => {
    const inviter = await createTestAccount({ email: "inviter@example.com", role: "admin" });
    const invited = await inviteAccount(testActor(inviter), {
      name: "Grace",
      email: "grace@example.com",
      role: "admin",
    });

    const link = await issueOperatorResetLink("grace@example.com");

    const rows = await getDb()
      .select()
      .from(accountTokens)
      .where(eq(accountTokens.accountId, invited.account.id));
    expect(rows.map((row) => row.kind)).toEqual(["invitation"]);
    await expect(
      acceptLink({
        token: tokenOf(invited.link.url),
        password: NEW_PASSWORD,
        clientIp: null,
        headers: new Headers(),
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(link.url).not.toBe(invited.link.url);
  });

  it.each([
    ["an unknown email", "nobody@example.com", "unknown_account"],
    ["a Member", "member@example.com", "not_admin"],
    ["a deactivated Admin", "off.admin@example.com", "deactivated"],
  ])("refuses %s, saying why, and writes nothing", async (_name, email, reason) => {
    await createTestAccount({ email: "member@example.com", role: "member" });
    await createTestAccount({ email: "off.admin@example.com", role: "admin", disabled: true });
    const linksBefore = (await getDb().select().from(accountTokens)).length;
    const auditBefore = (await getDb().select().from(auditLog)).length;

    const refusal = await refusalOf(issueOperatorResetLink(email));

    expect(refusal.reason).toBe(reason);
    expect(refusal.message).toBeTruthy();
    expect((await getDb().select().from(accountTokens)).length).toBe(linksBefore);
    expect((await getDb().select().from(auditLog)).length).toBe(auditBefore);
  });
});
