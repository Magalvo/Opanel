import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb } from "@/server/db/client";
import { accounts, credentials, sessions } from "@/server/db/schema";

import { getAuth } from "./auth";
import { hashPassword } from "./password";

const password = "correct horse battery staple";

async function createHuman(email = "ada@example.com", role: "admin" | "member" = "admin") {
  const db = getDb();
  const [account] = await db
    .insert(accounts)
    .values({ kind: "human", name: "Ada", email, role })
    .returning();
  if (!account) throw new Error("no account");
  await db.insert(credentials).values({
    accountId: account.id,
    providerId: "credential",
    providerAccountId: account.id,
    passwordHash: await hashPassword(password),
  });
  return account;
}

describe("Better Auth on Opanel's tables", () => {
  it("has telemetry disabled", () => {
    expect(getAuth().options.telemetry?.enabled).toBe(false);
  });

  it("signs in, creates a 7-day session and returns kind and role", async () => {
    const account = await createHuman();

    const result = await getAuth().api.signInEmail({
      body: { email: "ada@example.com", password },
    });

    expect(result.user.id).toBe(account.id);
    expect(result.user).toMatchObject({ kind: "human", role: "admin" });
    const rows = await getDb().select().from(sessions).where(eq(sessions.accountId, account.id));
    expect(rows).toHaveLength(1);
    const days = ((rows[0]?.expiresAt.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
  });

  it("rejects a wrong password, creates no session, and stores only an Argon2id hash", async () => {
    await createHuman();

    await expect(
      getAuth().api.signInEmail({
        body: { email: "ada@example.com", password: "wrong password!" },
      }),
    ).rejects.toThrow();

    expect(await getDb().select().from(sessions)).toHaveLength(0);
    const [credential] = await getDb().select().from(credentials);
    expect(credential?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(credential?.passwordHash).not.toContain(password);
  });

  it("deletes the session row on sign-out", async () => {
    await createHuman();
    const { headers } = await getAuth().api.signInEmail({
      body: { email: "ada@example.com", password },
      returnHeaders: true,
    });
    const cookie = (headers.getSetCookie()).map((c) => c.split(";")[0]).join("; ");
    expect(await getDb().select().from(sessions)).toHaveLength(1);

    await getAuth().api.signOut({ headers: new Headers({ cookie }) });

    expect(await getDb().select().from(sessions)).toHaveLength(0);
  });

  it("does not allow open sign-up", async () => {
    await expect(
      getAuth().api.signUpEmail({
        body: { name: "Eve", email: "eve@example.com", password },
      }),
    ).rejects.toThrow();

    expect(await getDb().select().from(accounts)).toHaveLength(0);
  });
});
