import { describe, expect, it } from "vitest";

import { contracts } from "@/lib/openapi/contracts";

import {
  createProjectRequestSchema,
  projectKeySchema,
  projectParamsSchema,
  projectQuerySchema,
  updateProjectRequestSchema,
} from "./projects";

const UUID = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

describe("project keys", () => {
  it("accept 2 to 10 uppercase letters and digits starting with a letter", () => {
    for (const key of ["OP", "OPA1", "A123456789"]) {
      expect(projectKeySchema.safeParse(key).success, key).toBe(true);
    }
    for (const key of ["O", "opa", "Opa", "1OP", "OP-1", "OP A", "ABCDEFGHIJK", ""]) {
      expect(projectKeySchema.safeParse(key).success, key).toBe(false);
    }
  });
});

describe("project requests", () => {
  it("create: trims the name, keeps the description, refuses unknown fields", () => {
    expect(createProjectRequestSchema.parse({ key: "OPA", name: "  Opanel " })).toEqual({
      key: "OPA",
      name: "Opanel",
    });
    expect(
      createProjectRequestSchema.parse({ key: "OPA", name: "O", description: "  *md*  " })
        .description,
    ).toBe("  *md*  ");
    expect(createProjectRequestSchema.safeParse({ key: "OPA", name: "" }).success).toBe(false);
    expect(
      createProjectRequestSchema.safeParse({ key: "OPA", name: "O", color: "red" }).success,
    ).toBe(false);
    expect(
      createProjectRequestSchema.safeParse({
        key: "OPA",
        name: "O",
        description: "x".repeat(10_001),
      }).success,
    ).toBe(false);
  });

  it("update: needs version and a field, and refuses the key", () => {
    expect(updateProjectRequestSchema.parse({ name: "New", version: 1 })).toEqual({
      name: "New",
      version: 1,
    });
    expect(updateProjectRequestSchema.safeParse({ description: "", version: 2 }).success).toBe(
      true,
    );
    expect(updateProjectRequestSchema.safeParse({ name: "New" }).success).toBe(false);
    expect(updateProjectRequestSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateProjectRequestSchema.safeParse({ key: "NEW", version: 1 }).success).toBe(false);
  });

  it("path: the project's id or its key, nothing else", () => {
    expect(projectParamsSchema.parse({ projectId: UUID })).toEqual({ projectId: UUID });
    expect(projectParamsSchema.parse({ projectId: "OPA" })).toEqual({ projectId: "OPA" });
    for (const value of ["opa", "x", "../OPA"]) {
      expect(projectParamsSchema.safeParse({ projectId: value }).success, value).toBe(false);
    }
  });

  it("query: archived is true or false, with pagination", () => {
    expect(projectQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(projectQuerySchema.parse({ archived: "true" })).toEqual({ limit: 50, archived: "true" });
    expect(projectQuerySchema.safeParse({ archived: "yes" }).success).toBe(false);
  });
});

describe("project contracts", () => {
  it("declare the access of WS-028 section 4", () => {
    const access = new Map(
      contracts.map((contract) => [
        `${contract.method.toUpperCase()} ${contract.path}`,
        contract.access,
      ]),
    );
    const read = { kind: "permission", permission: "projects:read" };
    const manage = { kind: "permission", permission: "projects:manage" };

    expect(access.get("GET /api/v1/projects")).toEqual(read);
    expect(access.get("GET /api/v1/projects/{projectId}")).toEqual(read);
    expect(access.get("POST /api/v1/projects")).toEqual(manage);
    expect(access.get("PATCH /api/v1/projects/{projectId}")).toEqual(manage);
    expect(access.get("POST /api/v1/projects/{projectId}/archive")).toEqual(manage);
    expect(access.get("POST /api/v1/projects/{projectId}/unarchive")).toEqual(manage);
  });
});
