import { describe, expect, it } from "vitest";

import { contracts } from "@/lib/openapi/contracts";

import {
  acceptLinkRequestSchema,
  accountSummarySchema,
  changePasswordRequestSchema,
  meResponseSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordSchema,
  setupRequestSchema,
  signInRequestSchema,
  updateMeRequestSchema,
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

    expect(byOperation.get("post /api/v1/auth/sign-in")?.access).toEqual({ kind: "public" });
    expect(byOperation.get("post /api/v1/auth/sign-out")?.access).toEqual({
      kind: "authenticated",
    });
    expect(byOperation.get("get /api/v1/me")?.access).toEqual({ kind: "authenticated" });
  });
});

describe("setupRequestSchema", () => {
  const valid = { name: "Ada Admin", email: "ada@example.com", password: "a".repeat(12) };

  it("accepts a name, an email and a password of 12 to 128 characters", () => {
    expect(setupRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("trims the name and rejects a blank or over-long one", () => {
    expect(setupRequestSchema.parse({ ...valid, name: "  Ada  " }).name).toBe("Ada");
    expect(setupRequestSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
    expect(setupRequestSchema.safeParse({ ...valid, name: "x".repeat(101) }).success).toBe(false);
  });

  it("rejects a bad email, a short password, a missing field and unknown fields", () => {
    for (const body of [
      { ...valid, email: "nope" },
      { ...valid, password: "a".repeat(11) },
      { name: valid.name, email: valid.email },
      { ...valid, role: "admin" },
    ]) {
      expect(setupRequestSchema.safeParse(body).success).toBe(false);
    }
  });

  it("is documented as a public operation", () => {
    const setup = contracts.find((c) => c.method === "post" && c.path === "/api/v1/setup");

    expect(setup?.access).toEqual({ kind: "public" });
    expect(Object.keys(setup?.responses ?? {})).toEqual(
      expect.arrayContaining(["201", "400", "403", "404", "415"]),
    );
  });
});

describe("acceptLinkRequestSchema", () => {
  const token = "A".repeat(43);
  const valid = { token, password: "a".repeat(12) };

  it("accepts a base64url token of 43 to 128 characters and a password of 12 to 128", () => {
    expect(acceptLinkRequestSchema.safeParse(valid).success).toBe(true);
    expect(acceptLinkRequestSchema.safeParse({ ...valid, token: "a_-9".repeat(32) }).success).toBe(
      true,
    );
    expect(acceptLinkRequestSchema.safeParse({ ...valid, password: "a".repeat(128) }).success).toBe(
      true,
    );
  });

  it("rejects a malformed token, a short or long password, missing and unknown fields", () => {
    for (const body of [
      { ...valid, token: "A".repeat(42) },
      { ...valid, token: "A".repeat(129) },
      { ...valid, token: `${"A".repeat(42)}!` },
      { ...valid, token: `${"A".repeat(42)}=` },
      { ...valid, password: "a".repeat(11) },
      { ...valid, password: "a".repeat(129) },
      { token },
      { password: valid.password },
      { ...valid, email: "ada@example.com" },
    ]) {
      expect(acceptLinkRequestSchema.safeParse(body).success).toBe(false);
    }
  });

  it("is documented as a public operation that can answer 404 and 429", () => {
    const accept = contracts.find(
      (c) => c.method === "post" && c.path === "/api/v1/account-links/accept",
    );

    expect(accept?.access).toEqual({ kind: "public" });
    expect(Object.keys(accept?.responses ?? {})).toEqual(
      expect.arrayContaining(["200", "400", "403", "404", "415", "429"]),
    );
  });
});

describe("updateMeRequestSchema", () => {
  it("accepts a name, trimmed, of 1 to 100 characters", () => {
    expect(updateMeRequestSchema.parse({ name: "  Ada Lovelace " })).toEqual({
      name: "Ada Lovelace",
    });
    expect(updateMeRequestSchema.safeParse({ name: "x".repeat(100) }).success).toBe(true);
  });

  it("rejects a blank or long name, a missing name and unknown fields", () => {
    for (const body of [
      { name: "   " },
      { name: "x".repeat(101) },
      {},
      { name: "Ada", email: "ada@example.com" },
      { name: "Ada", role: "admin" },
    ]) {
      expect(updateMeRequestSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("changePasswordRequestSchema", () => {
  const valid = { currentPassword: "old", newPassword: "a".repeat(12) };

  it("accepts any current password of 1 to 128 characters and a new one of 12 to 128", () => {
    expect(changePasswordRequestSchema.safeParse(valid).success).toBe(true);
    expect(
      changePasswordRequestSchema.safeParse({
        currentPassword: "x".repeat(128),
        newPassword: "a".repeat(128),
      }).success,
    ).toBe(true);
  });

  it("rejects empty or long passwords, a short new one, missing and unknown fields", () => {
    for (const body of [
      { ...valid, currentPassword: "" },
      { ...valid, currentPassword: "x".repeat(129) },
      { ...valid, newPassword: "a".repeat(11) },
      { ...valid, newPassword: "a".repeat(129) },
      { currentPassword: "old" },
      { newPassword: valid.newPassword },
      { ...valid, sessions: "keep" },
    ]) {
      expect(changePasswordRequestSchema.safeParse(body).success).toBe(false);
    }
  });

  it("never echoes a rejected password in its messages", () => {
    const secret = "tiny-secret"; // 11 characters: too short for a new password
    const result = changePasswordRequestSchema.safeParse({
      currentPassword: secret,
      newPassword: secret,
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain(secret);
  });
});

describe("own profile contracts", () => {
  it("document renaming oneself and changing one's password as authenticated", () => {
    const byOperation = new Map(
      contracts.map((contract) => [`${contract.method} ${contract.path}`, contract]),
    );
    const rename = byOperation.get("patch /api/v1/me");
    const password = byOperation.get("post /api/v1/me/password");

    expect(rename?.access).toEqual({ kind: "authenticated" });
    expect(Object.keys(rename?.responses ?? {})).toEqual(
      expect.arrayContaining(["200", "400", "403", "415"]),
    );
    expect(password?.access).toEqual({ kind: "authenticated" });
    expect(Object.keys(password?.responses ?? {})).toEqual(
      expect.arrayContaining(["204", "400", "403", "415", "429"]),
    );
  });
});
