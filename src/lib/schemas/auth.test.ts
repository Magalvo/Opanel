import { describe, expect, it } from "vitest";

import { contracts } from "@/lib/openapi/contracts";

import {
  accountSummarySchema,
  meResponseSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordSchema,
  signInRequestSchema,
} from "./auth";

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

describe("signInRequestSchema", () => {
  const valid = { email: "ada@example.com", password: "x" };

  it("accepts an email and a password of 1 to 128 characters", () => {
    expect(signInRequestSchema.safeParse(valid).success).toBe(true);
    expect(signInRequestSchema.safeParse({ ...valid, password: "x".repeat(128) }).success).toBe(
      true,
    );
  });

  it("rejects an empty or over-long password, a bad email, a missing field and unknown fields", () => {
    for (const body of [
      { ...valid, password: "" },
      { ...valid, password: "x".repeat(129) },
      { ...valid, email: "not-an-email" },
      { email: valid.email },
      { ...valid, remember: true },
    ]) {
      expect(signInRequestSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("account response schemas", () => {
  const account = {
    id: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
    kind: "human",
    name: "Ada",
    email: "ada@example.com",
    role: "admin",
  };

  it("describe the account and, for me, its permissions", () => {
    expect(accountSummarySchema.parse(account)).toEqual(account);
    expect(meResponseSchema.parse({ ...account, permissions: ["tasks:read"] }).permissions).toEqual(
      ["tasks:read"],
    );
    expect(meResponseSchema.safeParse({ ...account, permissions: ["tasks:fly"] }).success).toBe(
      false,
    );
  });
});

describe("auth contracts", () => {
  it("document sign-in as public and sign-out and me as authenticated", () => {
    const byOperation = new Map(
      contracts.map((contract) => [`${contract.method} ${contract.path}`, contract]),
    );

    expect(byOperation.get("post /api/v1/auth/sign-in")?.public).toBe(true);
    expect(byOperation.get("post /api/v1/auth/sign-out")?.public).toBe(false);
    expect(byOperation.get("get /api/v1/me")?.public).toBe(false);
  });
});
