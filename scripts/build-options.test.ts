import { describe, expect, it } from "vitest";

import { BUILD_SKIP_TYPECHECK, buildSkipsTypecheck } from "./build-options";

describe("buildSkipsTypecheck (WS-103)", () => {
  it('is true when the variable is "1"', () => {
    expect(buildSkipsTypecheck({ [BUILD_SKIP_TYPECHECK]: "1" })).toBe(true);
  });

  it("is false when the variable is unset", () => {
    expect(buildSkipsTypecheck({})).toBe(false);
  });

  it("refuses any other value", () => {
    for (const value of ["", "0", "true", "yes"]) {
      expect(() => buildSkipsTypecheck({ [BUILD_SKIP_TYPECHECK]: value }), value).toThrow(
        BUILD_SKIP_TYPECHECK,
      );
    }
  });
});
