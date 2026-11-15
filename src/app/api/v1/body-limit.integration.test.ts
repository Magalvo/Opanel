import { describe, expect, it } from "vitest";

import { problemSchema } from "@/lib/schemas/problem";
import { apiRequest } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { auditLog, rateLimits } from "@/server/db/schema";

import { POST as signIn } from "./auth/sign-in/route";

// WS-044 test 9: a refused body is refused before any service runs.
describe("an oversized request body", () => {
  it("is refused with 413 on a public endpoint, and writes no audit entry and no limiter row", async () => {
    const response = await signIn(
      apiRequest("POST", "/api/v1/auth/sign-in", {
        body: { email: "ada@example.com", password: "x".repeat(600_000) },
      }),
      undefined,
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    expect(problemSchema.parse(await response.json()).code).toBe("payload_too_large");
    expect(await getDb().select().from(auditLog)).toHaveLength(0);
    expect(await getDb().select().from(rateLimits)).toHaveLength(0);
  });
});
