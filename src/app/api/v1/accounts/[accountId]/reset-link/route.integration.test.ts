import { describe, expect, it } from "vitest";

import { resetLinkResponseSchema } from "@/lib/schemas/accounts";
import { apiRequest, createTestAccount, signInCookie } from "@/server/auth/testing";

import { POST } from "./route";

function context(accountId: string) {
  return { params: Promise.resolve({ accountId }) };
}

describe("POST /api/v1/accounts/{accountId}/reset-link", () => {
  it("returns a one-time link for an active account, 409 for a deactivated one, 404 for an unknown one", async () => {
    await createTestAccount({ email: "admin@example.com", role: "admin" });
    const cookie = await signInCookie("admin@example.com");
    const active = await createTestAccount({ email: "m@example.com" });
    const off = await createTestAccount({ email: "off@example.com", disabled: true });
    const call = (id: string) =>
      POST(apiRequest("POST", `/api/v1/accounts/${id}/reset-link`, { cookie }), context(id));

    const ok = await call(active.id);
    expect(ok.status).toBe(201);
    expect(resetLinkResponseSchema.parse(await ok.json()).link.url).toMatch(/\/accept#/);
    expect((await call(off.id)).status).toBe(409);
    expect((await call(crypto.randomUUID())).status).toBe(404);
  });
});
