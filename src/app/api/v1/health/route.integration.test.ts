import { describe, expect, it } from "vitest";

import { healthResponseSchema } from "@/lib/schemas/health";

import { GET } from "./route";

describe("GET /api/v1/health with a running database", () => {
  it("returns 200 with a body matching the schema and is not cacheable", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(healthResponseSchema.parse(await response.json())).toEqual({
      status: "ok",
      database: "up",
    });
  });
});
