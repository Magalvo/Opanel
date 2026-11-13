import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { problemSchema } from "@/lib/schemas/problem";
import { apiRequest, createTestAccount, signInCookie, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { accounts } from "@/server/db/schema";
import { inviteAccount } from "@/server/services/account-management";

import { DELETE } from "./route";

function context(accountId: string) {
  return { params: Promise.resolve({ accountId }) };
}

async function signedInAdmin() {
  const admin = await createTestAccount({ email: "admin@example.com", role: "admin" });
  return { admin, cookie: await signInCookie("admin@example.com") };
}

function revoke(accountId: string, cookie: string) {
  return DELETE(
    apiRequest("DELETE", `/api/v1/accounts/${accountId}/invitation`, { cookie }),
    context(accountId),
  );
}

describe("DELETE /api/v1/accounts/{accountId}/invitation", () => {
  it("answers 204 and removes the invited account", async () => {
    const { admin, cookie } = await signedInAdmin();
    const { account } = await inviteAccount(testActor(admin), {
      name: "Grace",
      email: "grace@exmaple.com",
      role: "member",
    });

    const response = await revoke(account.id, cookie);

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await getDb().select().from(accounts).where(eq(accounts.id, account.id))).toEqual([]);
  });

  it("answers 409 conflict for an account that has a password, and 404 for an unknown id", async () => {
    const { cookie } = await signedInAdmin();
    const member = await createTestAccount({ email: "member@example.com" });

    const accepted = await revoke(member.id, cookie);
    expect(accepted.status).toBe(409);
    expect(problemSchema.parse(await accepted.json()).code).toBe("conflict");

    const unknown = await revoke(crypto.randomUUID(), cookie);
    expect(unknown.status).toBe(404);
  });

  it("answers 400 for an id that is not a UUID", async () => {
    const { cookie } = await signedInAdmin();

    const response = await revoke("not-a-uuid", cookie);

    expect(response.status).toBe(400);
    expect(problemSchema.parse(await response.json()).errors?.map((e) => e.path)).toEqual([
      "accountId",
    ]);
  });
});
