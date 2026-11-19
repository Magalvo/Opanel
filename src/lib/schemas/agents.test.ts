import { describe, expect, it } from "vitest";

import {
  createAgentRequestSchema,
  createApiTokenRequestSchema,
  updateAgentRequestSchema,
} from "./agents";
import { AUDIT_ACTIONS } from "./audit";
import { PROBLEM_CODES } from "./problem";

const PROJECT = "7c1f0e9e-2c39-4c1e-9b8e-2b6f4f1c5a01";

function fieldErrors(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return (result.error?.issues ?? []).map((issue) => issue.path.join("."));
}

describe("createAgentRequestSchema (WS-075)", () => {
  it("trims the name and accepts a valid agent", () => {
    const parsed = createAgentRequestSchema.parse({
      name: "  QA Bot  ",
      role: "qa_agent",
      scopes: ["tasks:read"],
      projectIds: [PROJECT],
    });
    expect(parsed.name).toBe("QA Bot");
  });

  it("requires projectIds, which is null for all projects", () => {
    expect(createAgentRequestSchema.safeParse({ name: "A", role: "qa_agent" }).success).toBe(false);
    expect(
      createAgentRequestSchema.safeParse({ name: "A", role: "qa_agent", projectIds: null }).success,
    ).toBe(true);
  });

  it("refuses a scope outside the role, a duplicate scope, and duplicate projects", () => {
    const base = { name: "A", role: "qa_agent", projectIds: null };
    expect(
      fieldErrors(createAgentRequestSchema.safeParse({ ...base, scopes: ["tasks:write"] })),
    ).toContain("scopes");
    expect(
      fieldErrors(
        createAgentRequestSchema.safeParse({ ...base, scopes: ["tasks:read", "tasks:read"] }),
      ),
    ).toContain("scopes");
    expect(
      fieldErrors(createAgentRequestSchema.safeParse({ ...base, projectIds: [PROJECT, PROJECT] })),
    ).toContain("projectIds");
    expect(
      createAgentRequestSchema.safeParse({ ...base, role: "worker_agent", scopes: ["tasks:write"] })
        .success,
    ).toBe(true);
  });

  it("refuses an empty or long name, a long description, and unknown fields", () => {
    const base = { role: "qa_agent", projectIds: null };
    for (const body of [
      { ...base, name: "   " },
      { ...base, name: "x".repeat(81) },
      { ...base, name: "A", description: "x".repeat(501) },
      { ...base, name: "A", description: "" },
      { ...base, name: "A", admin: true },
    ]) {
      expect(createAgentRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe("updateAgentRequestSchema (WS-075)", () => {
  it("needs at least one field", () => {
    expect(updateAgentRequestSchema.safeParse({}).success).toBe(false);
    expect(updateAgentRequestSchema.safeParse({ active: false }).success).toBe(true);
  });

  it("checks scopes against a role sent with them", () => {
    expect(
      updateAgentRequestSchema.safeParse({ role: "qa_agent", scopes: ["tasks:write"] }).success,
    ).toBe(false);
    expect(updateAgentRequestSchema.safeParse({ scopes: ["tasks:write"] }).success).toBe(true);
  });
});

describe("createApiTokenRequestSchema (WS-075)", () => {
  it("defaults to 90 days and accepts only 30, 90, 365 or none", () => {
    expect(createApiTokenRequestSchema.parse({ name: "CI" }).expiresInDays).toBe(90);
    for (const days of [30, 90, 365, null]) {
      expect(
        createApiTokenRequestSchema.parse({ name: "CI", expiresInDays: days }).expiresInDays,
      ).toBe(days);
    }
    for (const days of [0, 7, 400, "90"]) {
      expect(
        createApiTokenRequestSchema.safeParse({ name: "CI", expiresInDays: days }).success,
      ).toBe(false);
    }
  });
});

describe("the catalogues (WS-075)", () => {
  it("know the new audit actions and problem codes", () => {
    for (const action of [
      "agent.created",
      "agent.updated",
      "agent.disabled",
      "agent.reenabled",
      "agent.token_created",
      "agent.token_revoked",
    ]) {
      expect(AUDIT_ACTIONS).toContain(action);
    }
    for (const code of ["agent_name_taken", "too_many_tokens", "agent_disabled"]) {
      expect(PROBLEM_CODES).toContain(code);
    }
  });
});
