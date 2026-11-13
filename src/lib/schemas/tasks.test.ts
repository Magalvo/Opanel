import { describe, expect, it } from "vitest";

import { contracts } from "@/lib/openapi/contracts";

import {
  createTaskRequestSchema,
  taskListQuerySchema,
  taskParamsSchema,
  updateTaskRequestSchema,
} from "./tasks";

const UUID = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

describe("task requests", () => {
  it("create: trimmed title 1..200, description up to 50 000, type defaulting to nothing sent", () => {
    expect(createTaskRequestSchema.parse({ title: "  Fix login  " })).toEqual({
      title: "Fix login",
    });
    expect(
      createTaskRequestSchema.parse({
        title: "T",
        description: " *md* ",
        type: "bug",
        columnId: UUID,
        assigneeTeamId: UUID,
        assigneeAccountId: UUID,
      }),
    ).toMatchObject({ description: " *md* ", type: "bug" });
    for (const body of [
      { title: "" },
      { title: "x".repeat(201) },
      { title: "T", description: "x".repeat(50_001) },
      { title: "T", type: "epic" },
      { title: "T", columnId: "abc" },
      { title: "T", assigneeTeamId: null },
      { title: "T", key: "OPA-1" },
    ]) {
      expect(
        createTaskRequestSchema.safeParse(body).success,
        JSON.stringify(body).slice(0, 60),
      ).toBe(false);
    }
  });

  it("update: needs version and a field; assignees may be null to clear", () => {
    expect(
      updateTaskRequestSchema.parse({ assigneeTeamId: null, assigneeAccountId: null, version: 2 }),
    ).toEqual({ assigneeTeamId: null, assigneeAccountId: null, version: 2 });
    expect(updateTaskRequestSchema.safeParse({ title: "T", version: 1 }).success).toBe(true);
    expect(updateTaskRequestSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateTaskRequestSchema.safeParse({ title: "T" }).success).toBe(false);
    expect(updateTaskRequestSchema.safeParse({ columnId: UUID, version: 1 }).success).toBe(false);
  });

  it("path: the task's id or its key", () => {
    for (const taskId of [UUID, "OPA-1", "A1-123", "OPA-999999999"]) {
      expect(taskParamsSchema.safeParse({ taskId }).success, taskId).toBe(true);
    }
    for (const taskId of ["opa-1", "OPA-0", "OPA-01", "OPA", "OPA-", "OPA-1-2", "1A-1"]) {
      expect(taskParamsSchema.safeParse({ taskId }).success, taskId).toBe(false);
    }
  });

  it("list query: optional column filter with pagination", () => {
    expect(taskListQuerySchema.parse({ columnId: UUID })).toEqual({ limit: 50, columnId: UUID });
    expect(taskListQuerySchema.safeParse({ columnId: "x" }).success).toBe(false);
  });
});

describe("task contracts", () => {
  it("declare tasks:read and tasks:write", () => {
    const byOperation = new Map(
      contracts.map((contract) => [`${contract.method.toUpperCase()} ${contract.path}`, contract]),
    );
    const read = { kind: "permission", permission: "tasks:read" };
    const write = { kind: "permission", permission: "tasks:write" };

    expect(byOperation.get("GET /api/v1/projects/{projectId}/tasks")?.access).toEqual(read);
    expect(byOperation.get("GET /api/v1/tasks/{taskId}")?.access).toEqual(read);
    expect(byOperation.get("POST /api/v1/projects/{projectId}/tasks")?.access).toEqual(write);
    expect(byOperation.get("PATCH /api/v1/tasks/{taskId}")?.access).toEqual(write);
  });
});
