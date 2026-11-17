import { describe, expect, it } from "vitest";

import { setupTokenMatches } from "./setup-token";

const expected = "0123456789abcdef0123456789abcdef";

describe("setupTokenMatches (WS-050)", () => {
  it("matches the same value", () => {
    expect(setupTokenMatches(expected, "0123456789abcdef".repeat(2))).toBe(true);
  });

  it.each([
    ["a different value of the same length", `${expected.slice(0, -1)}0`],
    ["a prefix", expected.slice(0, 16)],
    ["a longer value", `${expected}0`],
    ["an empty string", ""],
    ["no value", undefined],
  ])("does not match %s, and does not throw", (_case, given) => {
    expect(setupTokenMatches(expected, given)).toBe(false);
  });
});
