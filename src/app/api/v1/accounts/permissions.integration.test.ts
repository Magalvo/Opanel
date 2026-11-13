import { describe, expect, it, vi } from "vitest";

import { apiRequest, createTestAccount, signInCookie } from "@/server/auth/testing";

import { DELETE as revoke } from "./[accountId]/invitation/route";
import { POST as resetLink } from "./[accountId]/reset-link/route";
import { PATCH } from "./[accountId]/route";
import { GET, POST } from "./route";

function context(accountId: string) {
  return { params: Promise.resolve({ accountId }) };
}

describe("account management needs accounts:manage", () => {
  it("answers 403 to Viewer, Member and Manager on every operation, and 401 without a session", async () => {
    const target = await createTestAccount({ email: "target@example.com" });
    const calls = (cookie?: string) => [
      GET(apiRequest("GET", "/api/v1/accounts", { ...(cookie ? { cookie } : {}) }), undefined),
      POST(
        apiRequest("POST", "/api/v1/accounts", {
          ...(cookie ? { cookie } : {}),
          body: { name: "X", email: "x@example.com", role: "member" },
        }),
        undefined,
      ),
      PATCH(
        apiRequest("PATCH", `/api/v1/accounts/${target.id}`, {
          ...(cookie ? { cookie } : {}),
          body: { active: false },
        }),
        context(target.id),
      ),
      resetLink(
        apiRequest("POST", `/api/v1/accounts/${target.id}/reset-link`, {
          ...(cookie ? { cookie } : {}),
        }),
        context(target.id),
      ),
      revoke(
        apiRequest("DELETE", `/api/v1/accounts/${target.id}/invitation`, {
          ...(cookie ? { cookie } : {}),
        }),
        context(target.id),
      ),
    ];

    for (const role of ["viewer", "member", "manager"] as const) {
      await createTestAccount({ email: `${role}@example.com`, role });
      const cookie = await signInCookie(`${role}@example.com`);
      const statuses = (await Promise.all(calls(cookie))).map((response) => response.status);
      expect(statuses, role).toEqual([403, 403, 403, 403, 403]);
    }

    const anonymous = (await Promise.all(calls())).map((response) => response.status);
    expect(anonymous).toEqual([401, 401, 401, 401, 401]);
  });

  it("answers 403 for a foreign Origin on the state-changing operations, before the body is read", async () => {
    await createTestAccount({ email: "admin@example.com", role: "admin" });
    const cookie = await signInCookie("admin@example.com");
    const target = await createTestAccount({ email: "target@example.com" });
    const foreign = { Origin: "https://evil.example" };
    const patch = apiRequest("PATCH", `/api/v1/accounts/${target.id}`, {
      cookie,
      body: { active: false },
      headers: foreign,
    });
    const read = vi.spyOn(patch, "json");

    expect((await PATCH(patch, context(target.id))).status).toBe(403);
    expect(read).not.toHaveBeenCalled();
    expect(
      (
        await resetLink(
          apiRequest("POST", `/api/v1/accounts/${target.id}/reset-link`, {
            cookie,
            headers: foreign,
          }),
          context(target.id),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await revoke(
          apiRequest("DELETE", `/api/v1/accounts/${target.id}/invitation`, {
            cookie,
            headers: foreign,
          }),
          context(target.id),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await POST(
          apiRequest("POST", "/api/v1/accounts", {
            cookie,
            body: { name: "X", email: "x@example.com", role: "member" },
            headers: foreign,
          }),
          undefined,
        )
      ).status,
    ).toBe(403);
  });
});
