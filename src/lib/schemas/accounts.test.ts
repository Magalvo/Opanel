import { describe, expect, it } from "vitest";

import { contracts } from "@/lib/openapi/contracts";

import {
  accountLinkSchema,
  accountNameSchema,
  inviteRequestSchema,
  managedAccountSchema,
  updateAccountRequestSchema,
} from "./accounts";

describe("accountNameSchema", () => {
  it("trims, and accepts 1 to 100 characters", () => {
    expect(accountNameSchema.parse("  Grace Hopper ")).toBe("Grace Hopper");
    expect(accountNameSchema.safeParse("x".repeat(100)).success).toBe(true);
    expect(accountNameSchema.safeParse(" ").success).toBe(false);
    expect(accountNameSchema.safeParse("x".repeat(101)).success).toBe(false);
    expect(accountNameSchema.safeParse(42).success).toBe(false);
  });
});

describe("inviteRequestSchema", () => {
  const valid = { name: "Grace", email: "grace@example.com", role: "member" };

  it("accepts a name, an email and a human role, and trims the name", () => {
    expect(inviteRequestSchema.parse({ ...valid, name: "  Grace " }).name).toBe("Grace");
  });

  it("rejects a blank or long name, a bad email, an agent role and unknown fields", () => {
    for (const body of [
      { ...valid, name: "  " },
      { ...valid, name: "x".repeat(101) },
      { ...valid, email: "nope" },
      { ...valid, role: "qa_agent" },
      { ...valid, role: "owner" },
      { name: valid.name, email: valid.email },
      { ...valid, password: "x".repeat(12) },
    ]) {
      expect(inviteRequestSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("updateAccountRequestSchema", () => {
  it("accepts a role, active, or both", () => {
    expect(updateAccountRequestSchema.safeParse({ role: "manager" }).success).toBe(true);
    expect(updateAccountRequestSchema.safeParse({ active: false }).success).toBe(true);
    expect(updateAccountRequestSchema.safeParse({ role: "viewer", active: true }).success).toBe(
      true,
    );
  });

  it("needs at least one field and rejects unknown ones, agent roles and non-booleans", () => {
    for (const body of [
      {},
      { name: "x" },
      { role: "qa_agent" },
      { active: "no" },
      { role: null },
    ]) {
      expect(updateAccountRequestSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("response schemas", () => {
  it("describe an account with a derived status and a link with a URL and an expiry", () => {
    const account = {
      id: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
      name: "Grace",
      email: "grace@example.com",
      role: "member",
      status: "invited",
      createdAt: "2026-11-12T10:00:00.000Z",
      lastSeenAt: null,
    };
    expect(managedAccountSchema.parse(account)).toEqual(account);
    expect(managedAccountSchema.safeParse({ ...account, status: "gone" }).success).toBe(false);
    expect(
      accountLinkSchema.safeParse({
        url: "http://localhost:3000/accept#abc",
        expiresAt: "2026-11-19T10:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});

describe("account contracts", () => {
  it("document the four operations as authenticated, with 409 where a conflict can happen", () => {
    const byOperation = new Map(
      contracts.map((contract) => [`${contract.method} ${contract.path}`, contract]),
    );
    const operations = [
      "get /api/v1/accounts",
      "post /api/v1/accounts",
      "patch /api/v1/accounts/{accountId}",
      "post /api/v1/accounts/{accountId}/reset-link",
    ];

    for (const operation of operations) {
      expect(byOperation.get(operation)?.public, operation).toBe(false);
    }
    expect(Object.keys(byOperation.get("post /api/v1/accounts")?.responses ?? {})).toContain("409");
    expect(
      Object.keys(byOperation.get("patch /api/v1/accounts/{accountId}")?.responses ?? {}),
    ).toContain("409");
    expect(
      Object.keys(byOperation.get("post /api/v1/accounts/{accountId}/reset-link")?.responses ?? {}),
    ).toContain("409");
  });

  it("document revoking an invitation as authenticated, answering 204, 404 and 409", () => {
    const revoke = contracts.find(
      (c) => c.method === "delete" && c.path === "/api/v1/accounts/{accountId}/invitation",
    );

    expect(revoke?.public).toBe(false);
    expect(Object.keys(revoke?.responses ?? {})).toEqual(
      expect.arrayContaining(["204", "400", "404", "409"]),
    );
  });
});
