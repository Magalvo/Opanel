import { describe, expect, it } from "vitest";

import { safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  it.each(["/", "/projects/1", "/projects/1?tab=a&b=c", "/a#frag"])("keeps %s", (value) => {
    expect(safeNextPath(value)).toBe(value);
  });

  it.each([
    "//evil.com",
    "///evil.com",
    "/\\evil.com",
    "/%5Cevil.com",
    "https://evil.com",
    "http://localhost:3000/ok",
    "javascript:alert(1)",
    "evil.com",
    "",
    "/a\nb",
    "/a\u0000b",
    "/\t/evil.com",
  ])("falls back to / for %j", (value) => {
    expect(safeNextPath(value)).toBe("/");
  });

  it("falls back to / for anything that is not a single string", () => {
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath(["/a", "/b"])).toBe("/");
    expect(safeNextPath(42)).toBe("/");
  });
});
