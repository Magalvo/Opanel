import { describe, expect, it } from "vitest";

import { buildOpenApiDocument } from "@/lib/openapi/document";

import { GET } from "./route";

describe("GET /api/v1/openapi.json", () => {
  it("returns the generated document as JSON", async () => {
    const response = await GET(new Request("http://localhost/api/v1/openapi.json"), undefined);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    // Like every API response (canonical doc 0004, WS-025).
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await response.json()).toEqual(JSON.parse(JSON.stringify(buildOpenApiDocument())));
  });
});
