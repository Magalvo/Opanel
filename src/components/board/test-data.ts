// Test data shared by the board's tests (WS-037).
import type { Column } from "@/lib/schemas/columns";
import type { Label } from "@/lib/schemas/labels";
import type { Project } from "@/lib/schemas/projects";
import type { BugReport } from "@/lib/schemas/task-bug-reports";
import type { Task, TaskSummary } from "@/lib/schemas/tasks";

export const PROJECT_ID = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

export const opa: Project = {
  id: PROJECT_ID,
  key: "OPA",
  name: "Opanel",
  description: "",
  archivedAt: null,
  sprintsEnabled: false,
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
    parent: null,
    reporter: { id: "55555555-5555-4555-8555-555555555555", name: "Ada", kind: "human" },
    severity: null,
    fingerprint: null,
    occurrences: 0,
    lastReportedAt: null,
    priority: "none",
    dueDate: null,
    labels: [],
    subtasks: null,
    version: 1,
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
    deletedAt: null,
    ...extra,
  };
}

/** The full task the API answers for a summary, with a description. */
export function full(summary: TaskSummary, extra: Partial<Task> = {}): Task {
  return { ...summary, description: "", links: [], subtaskList: [], ...extra };
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

export const QA_BOT = {
  id: "14141414-1414-4414-8414-141414141414",
  name: "QA Bot",
  kind: "agent",
} as const;

/** A report the API answers for a task (WS-090), numbered so each has its own id. */
export function bugReport(n: number, taskId: string, extra: Partial<BugReport> = {}): BugReport {
  return {
    id: `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, "0")}`,
    taskId,
    agent: QA_BOT,
    outcome: "deduplicated",
    originLayer: "frontend",
    confidence: 0.8,
    severity: "high",
    fingerprint: "fp-login",
    runId: `run-${String(n)}`,
    title: `Report ${String(n)}`,
    summary: null,
    evidence: null,
    createdAt: "2026-11-20T10:00:00.000Z",
    ...extra,
  };
}

/** A label of the project, as the API answers it (WS-108). */
export function label(id: string, name: string, colour: Label["colour"], version = 1): Label {
  return {
    id,
    projectId: PROJECT_ID,
    name,
    colour,
    version,
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
  };
}

export const bugLabel = label("bbbb0000-0000-4000-8000-000000000001", "Bug", "red");
export const uiLabel = label("bbbb0000-0000-4000-8000-000000000002", "UI", "blue");
export const docsLabel = label("bbbb0000-0000-4000-8000-000000000003", "Docs", "green");

/** A label as a task holds it. */
export function ref({ id, name, colour }: Label) {
  return { id, name, colour };
}

export const LABELS = "GET /api/v1/projects/OPA/labels";
