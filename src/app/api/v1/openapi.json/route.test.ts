import { describe, expect, it } from "vitest";

import { buildOpenApiDocument } from "@/lib/openapi/document";

import { GET } from "./route";

describe("GET /api/v1/openapi.json", () => {
  it("returns the generated document as JSON", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual(JSON.parse(JSON.stringify(buildOpenApiDocument())));
  });
});
