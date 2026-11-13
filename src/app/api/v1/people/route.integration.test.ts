import { describe, expect, it } from "vitest";

import { personPageSchema } from "@/lib/schemas/people";
import { apiRequest, createTestAccount, signInCookie } from "@/server/auth/testing";

import { GET } from "./route";

describe("GET /api/v1/people", () => {
  it("lists people to a Viewer with id, name and active only", async () => {
    await createTestAccount({ name: "Vera", email: "viewer@example.com", role: "viewer" });
    await createTestAccount({ name: "Ada", email: "ada@example.com", role: "admin" });
    const cookie = await signInCookie("viewer@example.com");

    const response = await GET(
      apiRequest("GET", "/api/v1/people?q=a&limit=10", { cookie }),
      undefined,
    );

    expect(response.status).toBe(200);
    const text = await response.clone().text();
    expect(
      personPageSchema.parse(await response.json()).items.map((person) => person.name),
    ).toEqual(["Ada"]);
    for (const leak of ["email", "@example.com", "role", "admin", "status"]) {
      expect(text, leak).not.toContain(leak);
    }
  });

  it("answers 400 for an invalid query and 401 without a session", async () => {
    await createTestAccount({ email: "viewer@example.com", role: "viewer" });
    const cookie = await signInCookie("viewer@example.com");

    const invalid = await GET(apiRequest("GET", "/api/v1/people?email=x", { cookie }), undefined);
    const anonymous = await GET(apiRequest("GET", "/api/v1/people"), undefined);

    expect(invalid.status).toBe(400);
    expect(anonymous.status).toBe(401);
  });
});
