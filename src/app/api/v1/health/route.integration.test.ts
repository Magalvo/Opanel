import { describe, expect, it } from "vitest";

import { healthResponseSchema } from "@/lib/schemas/health";

import { GET } from "./route";

describe("GET /api/v1/health with a running database", () => {
  it("returns 200 with a body matching the schema and is not cacheable", async () => {
    const response = await GET(new Request("http://localhost/api/v1/health"), undefined);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    // Every API response carries a request id (canonical doc 0004, WS-025).
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(healthResponseSchema.parse(await response.json())).toEqual({
      status: "ok",
      database: "up",
    });
  });
});
