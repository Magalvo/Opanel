import { describe, expect, it } from "vitest";

import { contracts } from "@/lib/openapi/contracts";

import {
  createTaskRequestSchema,
  moveTaskRequestSchema,
  taskListQuerySchema,
  taskParamsSchema,
  taskSchema,
  taskSummarySchema,
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

  it("take an epic: an id on create, an id or null on update (WS-033)", () => {
    expect(createTaskRequestSchema.parse({ title: "T", epicId: UUID }).epicId).toBe(UUID);
    expect(createTaskRequestSchema.safeParse({ title: "T", epicId: null }).success).toBe(false);
    expect(updateTaskRequestSchema.parse({ epicId: null, version: 1 })).toEqual({
      epicId: null,
      version: 1,
    });
    expect(updateTaskRequestSchema.safeParse({ epicId: "x", version: 1 }).success).toBe(false);
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

  it("list query: optional column filter and deleted flag, with pagination", () => {
    expect(taskListQuerySchema.parse({ columnId: UUID })).toEqual({ limit: 50, columnId: UUID });
    expect(taskListQuerySchema.parse({ deleted: "true" })).toEqual({ limit: 50, deleted: "true" });
    expect(taskListQuerySchema.safeParse({ columnId: "x" }).success).toBe(false);
    expect(taskListQuerySchema.safeParse({ deleted: "yes" }).success).toBe(false);
  });
});

describe("severity and the bug fields (WS-088)", () => {
  const task = {
    id: UUID,
    key: "OPA-1",
    number: 1,
    projectId: UUID,
    type: "bug",
    title: "Crash",
    columnId: UUID,
    assigneeTeam: null,
    assignee: null,
    epic: null,
    reporter: { id: UUID, name: "QA Bot", kind: "agent" },
    severity: "high",
    fingerprint: "fp-1",
    occurrences: 2,
    lastReportedAt: "2026-11-20T08:30:00.123Z",
    priority: "none",
    dueDate: null,
    links: [
      {
        type: "regression_of",
        direction: "outgoing",
        task: { id: UUID, key: "OPA-0", title: "Old crash" },
      },
    ],
    version: 1,
    createdAt: "2026-11-20T08:00:00.000Z",
    updatedAt: "2026-11-20T08:30:00.123Z",
    deletedAt: null,
    description: "",
  };

  it("a task carries severity, fingerprint, occurrences and lastReportedAt", () => {
    expect(taskSchema.parse(task)).toEqual(task);
    for (const field of ["severity", "fingerprint", "occurrences", "lastReportedAt", "links"]) {
      const { [field]: _omitted, ...without } = task as Record<string, unknown>;
      expect(taskSchema.safeParse(without).success, field).toBe(false);
    }
    expect(taskSchema.safeParse({ ...task, severity: "urgent" }).success).toBe(false);
    expect(taskSchema.safeParse({ ...task, occurrences: -1 }).success).toBe(false);
    // Links (WS-090): a type of the catalogue and a direction.
    const [link] = task.links;
    expect(taskSchema.safeParse({ ...task, links: [] }).success).toBe(true);
    expect(taskSchema.safeParse({ ...task, links: [{ ...link, type: "blocks" }] }).success).toBe(
      false,
    );
    expect(taskSchema.safeParse({ ...task, links: [{ ...link, direction: "both" }] }).success).toBe(
      false,
    );
  });

  it("create: a severity only with type bug; the pipeline's fields are refused", () => {
    expect(createTaskRequestSchema.parse({ title: "T", type: "bug", severity: "low" })).toEqual({
      title: "T",
      type: "bug",
      severity: "low",
    });
    for (const body of [
      { title: "T", severity: "low" },
      { title: "T", type: "task", severity: "low" },
      { title: "T", type: "story", severity: "low" },
    ]) {
      const result = createTaskRequestSchema.safeParse(body);
      expect(result.success, JSON.stringify(body)).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual(["severity"]);
    }
    for (const body of [
      { title: "T", type: "bug", severity: null },
      { title: "T", type: "bug", fingerprint: "fp" },
      { title: "T", type: "bug", occurrences: 1 },
    ]) {
      expect(createTaskRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it("update: severity alone is a change, null clears it; the pipeline's fields are refused", () => {
    expect(updateTaskRequestSchema.parse({ severity: "critical", version: 1 })).toEqual({
      severity: "critical",
      version: 1,
    });
    expect(updateTaskRequestSchema.parse({ severity: null, version: 1 })).toEqual({
      severity: null,
      version: 1,
    });
    for (const body of [
      { severity: "urgent", version: 1 },
      { lastReportedAt: "2026-11-20T08:30:00.000Z", version: 1 },
      { occurrences: 2, version: 1 },
      { fingerprint: "fp", version: 1 },
    ]) {
      expect(updateTaskRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe("move request (WS-031)", () => {
  it("needs a column and a version, and takes at most one anchor", () => {
    expect(moveTaskRequestSchema.parse({ columnId: UUID, version: 1 })).toEqual({
      columnId: UUID,
      version: 1,
    });
    expect(
      moveTaskRequestSchema.safeParse({ columnId: UUID, afterTaskId: UUID, version: 1 }).success,
    ).toBe(true);
    expect(
      moveTaskRequestSchema.safeParse({ columnId: UUID, beforeTaskId: UUID, version: 1 }).success,
    ).toBe(true);
    for (const body of [
      { version: 1 },
      { columnId: UUID },
      { columnId: UUID, afterTaskId: UUID, beforeTaskId: UUID, version: 1 },
      { columnId: UUID, afterTaskId: "OPA-1", version: 1 },
      { columnId: UUID, afterTaskId: null, version: 1 },
      { columnId: UUID, position: "a0", version: 1 },
    ]) {
      expect(moveTaskRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
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
    expect(byOperation.get("GET /api/v1/projects/{projectId}/backlog")?.access).toEqual(read);
    expect(byOperation.get("GET /api/v1/tasks/{taskId}")?.access).toEqual(read);
    expect(byOperation.get("POST /api/v1/projects/{projectId}/tasks")?.access).toEqual(write);
    expect(byOperation.get("PATCH /api/v1/tasks/{taskId}")?.access).toEqual(write);
    expect(byOperation.get("POST /api/v1/tasks/{taskId}/move")?.access).toEqual(write);
    expect(byOperation.get("DELETE /api/v1/tasks/{taskId}")?.access).toEqual({
      kind: "permission",
      permission: "tasks:delete_own",
    });
    expect(byOperation.get("POST /api/v1/tasks/{taskId}/restore")?.access).toEqual({
      kind: "permission",
      permission: "tasks:delete_any",
    });
  });
});

describe("the backlog (WS-101)", () => {
  it("a task and a task summary may have no column", () => {
    const summary = {
      id: UUID,
      key: "OPA-1",
      number: 1,
      projectId: UUID,
      type: "task",
      title: "T",
      columnId: null,
      assigneeTeam: null,
      assignee: null,
      epic: null,
      reporter: { id: UUID, name: "Mia", kind: "human" },
      severity: null,
      fingerprint: null,
      occurrences: 0,
      lastReportedAt: null,
      priority: "none",
      dueDate: null,
      version: 1,
      createdAt: "2026-11-21T08:00:00.000Z",
      updatedAt: "2026-11-21T08:00:00.000Z",
      deletedAt: null,
    };
    expect(taskSummarySchema.parse(summary)).toEqual(summary);
    const task = { ...summary, description: "", links: [] };
    expect(taskSchema.parse(task)).toEqual(task);
    expect(taskSchema.safeParse({ ...task, columnId: "OPA" }).success).toBe(false);
  });

  it("create takes columnId null for the backlog, or none for the first column", () => {
    expect(createTaskRequestSchema.parse({ title: "T", columnId: null })).toEqual({
      title: "T",
      columnId: null,
    });
    expect(createTaskRequestSchema.parse({ title: "T" })).toEqual({ title: "T" });
  });

  it("move takes columnId null for the backlog, and still requires columnId", () => {
    expect(moveTaskRequestSchema.parse({ columnId: null, version: 1 })).toEqual({
      columnId: null,
      version: 1,
    });
    expect(
      moveTaskRequestSchema.safeParse({ columnId: null, afterTaskId: UUID, version: 1 }).success,
    ).toBe(true);
    expect(moveTaskRequestSchema.safeParse({ version: 1 }).success).toBe(false);
  });
});

describe("priority and due date (WS-102)", () => {
  const summary = {
    id: UUID,
    key: "OPA-1",
    number: 1,
    projectId: UUID,
    type: "task",
    title: "T",
    columnId: UUID,
    assigneeTeam: null,
    assignee: null,
    epic: null,
    reporter: { id: UUID, name: "Mia", kind: "human" },
    severity: null,
    fingerprint: null,
    occurrences: 0,
    lastReportedAt: null,
    priority: "high",
    dueDate: "2026-12-01",
    version: 1,
    createdAt: "2026-11-21T08:00:00.000Z",
    updatedAt: "2026-11-21T08:00:00.000Z",
    deletedAt: null,
  };

  it("a task and a task summary require priority and dueDate", () => {
    const task = { ...summary, description: "", links: [] };
    expect(taskSummarySchema.parse(summary)).toEqual(summary);
    expect(taskSchema.parse(task)).toEqual(task);
    for (const field of ["priority", "dueDate"]) {
      const { [field]: _omitted, ...without } = task as Record<string, unknown>;
      expect(taskSchema.safeParse(without).success, field).toBe(false);
      const { [field]: _gone, ...bare } = summary as Record<string, unknown>;
      expect(taskSummarySchema.safeParse(bare).success, field).toBe(false);
    }
    for (const priority of ["none", "low", "medium", "high", "urgent"]) {
      expect(taskSchema.safeParse({ ...task, priority }).success, priority).toBe(true);
    }
    expect(taskSchema.safeParse({ ...task, priority: "critical" }).success).toBe(false);
    expect(taskSchema.parse({ ...task, dueDate: null }).dueDate).toBeNull();
  });

  it("create takes priority and dueDate, each optional; dueDate is not null there", () => {
    expect(
      createTaskRequestSchema.parse({ title: "T", priority: "urgent", dueDate: "2026-12-01" }),
    ).toEqual({ title: "T", priority: "urgent", dueDate: "2026-12-01" });
    expect(createTaskRequestSchema.parse({ title: "T" })).toEqual({ title: "T" });
    expect(createTaskRequestSchema.safeParse({ title: "T", dueDate: null }).success).toBe(false);
    expect(createTaskRequestSchema.safeParse({ title: "T", priority: "critical" }).success).toBe(
      false,
    );
  });

  it("update: priority alone and dueDate alone are changes; null clears the date", () => {
    expect(updateTaskRequestSchema.parse({ priority: "low", version: 1 })).toEqual({
      priority: "low",
      version: 1,
    });
    expect(updateTaskRequestSchema.parse({ dueDate: null, version: 1 })).toEqual({
      dueDate: null,
      version: 1,
    });
    expect(updateTaskRequestSchema.parse({ dueDate: "2020-01-01", version: 1 })).toEqual({
      dueDate: "2020-01-01",
      version: 1,
    });
    expect(updateTaskRequestSchema.safeParse({ priority: null, version: 1 }).success).toBe(false);
  });

  it("refuses a bad date naming dueDate, on create and on update", () => {
    for (const dueDate of ["2026-02-30", "0000-01-01", "2026-1-01", "2026-12-31T00:00"]) {
      for (const result of [
        createTaskRequestSchema.safeParse({ title: "T", dueDate }),
        updateTaskRequestSchema.safeParse({ dueDate, version: 1 }),
      ]) {
        expect(result.success, dueDate).toBe(false);
        expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual(["dueDate"]);
      }
    }
  });
});
