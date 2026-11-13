import { describe, expect, it } from "vitest";

import { contracts } from "@/lib/openapi/contracts";

import { peopleQuerySchema } from "./people";
import {
  addMemberRequestSchema,
  createTeamRequestSchema,
  teamIdParamsSchema,
  teamMemberParamsSchema,
  updateTeamRequestSchema,
} from "./teams";

const UUID = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

describe("team request schemas", () => {
  it("trim names and accept 1 to 100 characters", () => {
    expect(createTeamRequestSchema.parse({ name: "  Frontend  " })).toEqual({ name: "Frontend" });
    expect(updateTeamRequestSchema.parse({ name: "x".repeat(100) }).name).toHaveLength(100);
    for (const name of ["", "   ", "x".repeat(101)]) {
      expect(createTeamRequestSchema.safeParse({ name }).success, name).toBe(false);
      expect(updateTeamRequestSchema.safeParse({ name }).success, name).toBe(false);
    }
  });

  it("reject unknown fields", () => {
    expect(createTeamRequestSchema.safeParse({ name: "A", id: UUID }).success).toBe(false);
    expect(addMemberRequestSchema.safeParse({ accountId: UUID, role: "x" }).success).toBe(false);
  });

  it("require UUIDs for ids", () => {
    expect(addMemberRequestSchema.safeParse({ accountId: "abc" }).success).toBe(false);
    expect(teamIdParamsSchema.safeParse({ teamId: "abc" }).success).toBe(false);
    expect(teamMemberParamsSchema.parse({ teamId: UUID, accountId: UUID })).toEqual({
      teamId: UUID,
      accountId: UUID,
    });
  });
});

describe("people query", () => {
  it("takes an optional trimmed prefix of 1 to 100 characters, with pagination", () => {
    expect(peopleQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(peopleQuerySchema.parse({ q: " ad ", limit: "10" })).toEqual({ q: "ad", limit: 10 });
    for (const q of ["", "  ", "x".repeat(101)]) {
      expect(peopleQuerySchema.safeParse({ q }).success, q).toBe(false);
    }
    expect(peopleQuerySchema.safeParse({ name: "a" }).success).toBe(false);
  });
});

describe("team and people contracts", () => {
  it("declare the access of WS-026 section 5", () => {
    const access = new Map(
      contracts.map((contract) => [
        `${contract.method.toUpperCase()} ${contract.path}`,
        contract.access,
      ]),
    );
    const read = { kind: "permission", permission: "projects:read" };
    const manage = { kind: "permission", permission: "teams:manage" };

    expect(access.get("GET /api/v1/people")).toEqual(read);
    expect(access.get("GET /api/v1/teams")).toEqual(read);
    expect(access.get("GET /api/v1/teams/{teamId}")).toEqual(read);
    expect(access.get("POST /api/v1/teams")).toEqual(manage);
    expect(access.get("PATCH /api/v1/teams/{teamId}")).toEqual(manage);
    expect(access.get("DELETE /api/v1/teams/{teamId}")).toEqual(manage);
    expect(access.get("POST /api/v1/teams/{teamId}/members")).toEqual(manage);
    expect(access.get("DELETE /api/v1/teams/{teamId}/members/{accountId}")).toEqual(manage);
  });
});
