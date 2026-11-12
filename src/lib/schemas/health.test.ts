import { describe, expect, it } from "vitest";

import { healthResponseSchema } from "./health";

describe("healthResponseSchema", () => {
  it.each([
    { status: "ok", database: "up" },
    { status: "degraded", database: "down" },
  ])("accepts %o", (body) => {
    expect(healthResponseSchema.parse(body)).toEqual(body);
  });

  it.each([
    ["an unknown status", { status: "fine", database: "up" }],
    ["an unknown database state", { status: "ok", database: "maybe" }],
    ["a missing field", { status: "ok" }],
    ["an extra field", { status: "ok", database: "up", version: "18.6" }],
  ])("rejects %s", (_label, body) => {
    expect(healthResponseSchema.safeParse(body).success).toBe(false);
  });
});
