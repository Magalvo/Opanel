import { describe, expect, it } from "vitest";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordSchema } from "./auth";

describe("passwordSchema", () => {
  it("uses the 12 to 128 character range", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });

  it("accepts 12 and 128 characters", () => {
    expect(passwordSchema.safeParse("a".repeat(12)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(128)).success).toBe(true);
  });

  it("rejects 11 and 129 characters", () => {
    expect(passwordSchema.safeParse("a".repeat(11)).success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(129)).success).toBe(false);
  });

  it("has no composition rules: all lower case is fine", () => {
    expect(passwordSchema.safeParse("correcthorsebatterystaple").success).toBe(true);
  });

  it("rejects values that are not strings", () => {
    for (const value of [undefined, null, 123456789012, ["a".repeat(12)]]) {
      expect(passwordSchema.safeParse(value).success).toBe(false);
    }
  });

  it("never echoes the rejected value in its messages", () => {
    const result = passwordSchema.safeParse("short-pw");
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain("short-pw");
  });
});
