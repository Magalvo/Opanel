import { describe, expect, it } from "vitest";

import { versionSchema } from "./version";

describe("versionSchema", () => {
  it("accepts whole numbers from 1", () => {
    for (const value of [1, 2, 1_000_000]) {
      expect(versionSchema.parse(value)).toBe(value);
    }
  });

  it("refuses 0, negatives, fractions and strings", () => {
    for (const value of [0, -1, 1.5, "1", null]) {
      expect(versionSchema.safeParse(value).success, String(value)).toBe(false);
    }
  });
});
