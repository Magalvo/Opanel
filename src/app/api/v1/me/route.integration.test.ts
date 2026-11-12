import { describe, expect, it } from "vitest";

import { meResponseSchema } from "@/lib/schemas/auth";
import { APP_ORIGIN, createTestAccount, signInCookie } from "@/server/auth/testing";
import { HUMAN_ROLE_PERMISSIONS } from "@/server/auth/roles";

import { GET } from "./route";

function request(headers: Record<string, string> = {}): Request {
  return new Request(`${APP_ORIGIN}/api/v1/me`, { headers });
}

describe("GET /api/v1/me", () => {
  it("returns the signed-in account with the permissions of its role", async () => {
    const account = await createTestAccount({ role: "viewer" });
    const cookie = await signInCookie();

    const response = await GET(request({ Cookie: cookie }), undefined);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = meResponseSchema.parse(await response.json());
    expect(body).toMatchObject({ id: account.id, role: "viewer", kind: "human" });
    expect(new Set(body.permissions)).toEqual(HUMAN_ROLE_PERMISSIONS.viewer);
  });

  it("answers 401 without a session, with the problem body", async () => {
    const response = await GET(request(), undefined);

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});
