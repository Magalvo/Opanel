import { describe, expect, it } from "vitest";

import { managedAccountSchema } from "@/lib/schemas/accounts";
import { problemSchema } from "@/lib/schemas/problem";
import { apiRequest, createTestAccount, signInCookie } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { accounts } from "@/server/db/schema";

import { PATCH } from "./route";

function context(accountId: string) {
  return { params: Promise.resolve({ accountId }) };
}

async function adminCookie(): Promise<string> {
  await createTestAccount({ email: "admin@example.com", role: "admin" });
  return signInCookie("admin@example.com");
}

describe("PATCH /api/v1/accounts/{accountId}", () => {
  it("changes the role and deactivates, returning the account", async () => {
    const cookie = await adminCookie();
    const member = await createTestAccount({ email: "m@example.com" });

    const response = await PATCH(
      apiRequest("PATCH", `/api/v1/accounts/${member.id}`, {
        cookie,
        body: { role: "manager", active: false },
      }),
      context(member.id),
    );

    expect(response.status).toBe(200);
    expect(managedAccountSchema.parse(await response.json())).toMatchObject({
      role: "manager",
      status: "deactivated",
    });
  });

  it("answers 400 for a bad id, an empty body, an agent role and unknown fields", async () => {
    const cookie = await adminCookie();
    const member = await createTestAccount({ email: "m@example.com" });
    const url = `/api/v1/accounts/${member.id}`;

    expect(
      (
        await PATCH(
          apiRequest("PATCH", "/api/v1/accounts/not-a-uuid", { cookie, body: { active: true } }),
          context("not-a-uuid"),
        )
      ).status,
    ).toBe(400);
    for (const body of [{}, { role: "qa_agent" }, { name: "x" }]) {
      expect(
        (await PATCH(apiRequest("PATCH", url, { cookie, body }), context(member.id))).status,
      ).toBe(400);
    }
  });

  it("answers 404 for an unknown id and for an agent", async () => {
    const cookie = await adminCookie();
    const [agent] = await getDb()
      .insert(accounts)
      .values({ kind: "agent", name: "bot", email: null, role: "qa_agent" })
      .returning();

    for (const id of [crypto.randomUUID(), agent?.id ?? ""]) {
      const response = await PATCH(
        apiRequest("PATCH", `/api/v1/accounts/${id}`, { cookie, body: { active: false } }),
        context(id),
      );
      expect(response.status).toBe(404);
    }
  });

  it("answers 409 with the code last_admin when it would leave no active Admin", async () => {
    await createTestAccount({ email: "admin@example.com", role: "admin" });
    const cookie = await signInCookie("admin@example.com");
    const [self] = await getDb().select().from(accounts);

    const response = await PATCH(
      apiRequest("PATCH", `/api/v1/accounts/${self?.id ?? ""}`, {
        cookie,
        body: { role: "member" },
      }),
      context(self?.id ?? ""),
    );

    expect(response.status).toBe(409);
    expect(problemSchema.parse(await response.json()).code).toBe("last_admin");
  });
});
