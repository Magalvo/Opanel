// Test data shared by the board's tests (WS-037).
import type { Column } from "@/lib/schemas/columns";
import type { Project } from "@/lib/schemas/projects";
import type { Task, TaskSummary } from "@/lib/schemas/tasks";

export const PROJECT_ID = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

export const opa: Project = {
  id: PROJECT_ID,
  key: "OPA",
  name: "Opanel",
  description: "",
  archivedAt: null,
  version: 3,
  createdAt: "2026-11-12T10:00:00.000Z",
  updatedAt: "2026-11-12T10:00:00.000Z",
};

export function column(id: string, name: string, category: Column["category"]): Column {
  return {
    id,
    projectId: PROJECT_ID,
    name,
    category,
    version: 1,
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
  };
}

export const todo = column("11111111-1111-4111-8111-111111111111", "To do", "todo");
export const doing = column("22222222-2222-4222-8222-222222222222", "In progress", "in_progress");
export const done = column("33333333-3333-4333-8333-333333333333", "Done", "done");

export function task(
  number: number,
  columnId: string,
  extra: Partial<TaskSummary> = {},
): TaskSummary {
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(number).padStart(12, "0")}`,
    key: `OPA-${String(number)}`,
    number,
    projectId: PROJECT_ID,
    type: "task",
    title: `Task ${String(number)}`,
    columnId,
    assigneeTeam: null,
    assignee: null,
    epic: null,
    reporter: { id: "55555555-5555-4555-8555-555555555555", name: "Ada" },
    version: 1,
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
    deletedAt: null,
    ...extra,
  };
}

/** The full task the API answers for a summary, with a description. */
export function full(summary: TaskSummary, extra: Partial<Task> = {}): Task {
  return { ...summary, description: "", ...extra };
}

export const PROJECT = "GET /api/v1/projects/OPA";
export const COLUMNS = "GET /api/v1/projects/OPA/columns";
export const TASKS = "GET /api/v1/projects/OPA/tasks?limit=100";

export function json(body: unknown, status = 200) {
  return () => Response.json(body, { status });
}

export function page(items: unknown[], nextCursor: string | null = null) {
  return json({ items, nextCursor });
}
