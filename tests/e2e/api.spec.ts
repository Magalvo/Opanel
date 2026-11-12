import { expect, test } from "@playwright/test";
import { z } from "zod";

import { healthResponseSchema } from "@/lib/schemas/health";
import { problemSchema } from "@/lib/schemas/problem";

test.describe("public API", () => {
  test("GET /api/v1/health reports a healthy service", async ({ request }) => {
    const response = await request.get("/api/v1/health");

    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(healthResponseSchema.parse(await response.json())).toEqual({
      status: "ok",
      database: "up",
    });
  });

  test("GET /api/v1/openapi.json describes the health endpoint", async ({ request }) => {
    const response = await request.get("/api/v1/openapi.json");

    expect(response.status()).toBe(200);
    const document = z
      .object({ openapi: z.string(), paths: z.record(z.string(), z.unknown()) })
      .parse(await response.json());
    expect(document.openapi).toMatch(/^3\.1\./);
    expect(Object.keys(document.paths)).toContain("/api/v1/health");
  });

  test("an unknown API path returns a 404 problem body, not an HTML page", async ({ request }) => {
    for (const response of [
      await request.get("/api/v1/does-not-exist"),
      await request.post("/api/nope/deeper", { data: { any: "thing" } }),
    ]) {
      expect(response.status()).toBe(404);
      expect(response.headers()["content-type"]).toBe("application/problem+json");
      expect(response.headers()["cache-control"]).toBe("no-store");
      const problem = problemSchema.parse(await response.json());
      expect(problem.code).toBe("not_found");
      expect(problem.requestId).toBe(response.headers()["x-request-id"]);
    }
  });
});
