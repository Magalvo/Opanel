import { describe, expect, it } from "vitest";

import { contracts } from "@/lib/openapi/contracts";

import {
  columnParamsSchema,
  createColumnRequestSchema,
  moveColumnRequestSchema,
  updateColumnRequestSchema,
} from "./columns";

const UUID = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

describe("column requests", () => {
  it("create: trimmed name 1..100, a category, and an optional anchor that may be null", () => {
    expect(createColumnRequestSchema.parse({ name: " Review ", category: "in_progress" })).toEqual({
      name: "Review",
      category: "in_progress",
    });
    expect(
      createColumnRequestSchema.parse({ name: "R", category: "todo", afterColumnId: null })
        .afterColumnId,
    ).toBeNull();
    for (const body of [
      { name: "", category: "todo" },
      { name: "R", category: "doing" },
      { name: "R", category: "todo", afterColumnId: "abc" },
      { name: "R", category: "todo", position: "a0" },
    ]) {
      expect(createColumnRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it("update: needs version and a field", () => {
    expect(updateColumnRequestSchema.safeParse({ name: "R", version: 1 }).success).toBe(true);
    expect(updateColumnRequestSchema.safeParse({ category: "done", version: 3 }).success).toBe(
      true,
    );
    expect(updateColumnRequestSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateColumnRequestSchema.safeParse({ name: "R" }).success).toBe(false);
  });

  it("move: an anchor or null, and version, both required", () => {
    expect(moveColumnRequestSchema.parse({ afterColumnId: null, version: 1 })).toEqual({
      afterColumnId: null,
      version: 1,
    });
    expect(moveColumnRequestSchema.safeParse({ afterColumnId: UUID }).success).toBe(false);
    expect(moveColumnRequestSchema.safeParse({ version: 1 }).success).toBe(false);
  });

  it("path: a column id", () => {
    expect(columnParamsSchema.safeParse({ columnId: UUID }).success).toBe(true);
    expect(columnParamsSchema.safeParse({ columnId: "OPA" }).success).toBe(false);
  });
});

describe("column contracts", () => {
  it("declare the access of WS-029 section 1", () => {
    const byOperation = new Map(
      contracts.map((contract) => [`${contract.method.toUpperCase()} ${contract.path}`, contract]),
    );
    const read = { kind: "permission", permission: "projects:read" };
    const manage = { kind: "permission", permission: "projects:manage" };

    expect(byOperation.get("GET /api/v1/projects/{projectId}/columns")?.access).toEqual(read);
    for (const operation of [
      "POST /api/v1/projects/{projectId}/columns",
      "PATCH /api/v1/columns/{columnId}",
      "POST /api/v1/columns/{columnId}/move",
      "DELETE /api/v1/columns/{columnId}",
    ]) {
      expect(byOperation.get(operation)?.access, operation).toEqual(manage);
    }
  });
});
