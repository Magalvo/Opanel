import { call, jsonBody } from "@/lib/api-client";
import { MAX_PAGE_LIMIT } from "@/lib/schemas/pagination";
import {
  type CreateTaskRequest,
  type MoveTaskRequest,
  taskPageSchema,
  taskSchema,
  type TaskSummary,
} from "@/lib/schemas/tasks";

import { uniqueTasks } from "./live";

export { listColumns } from "@/components/projects/api";

/** Every task of the project, in board order: the board loads every page (WT-03 decision 11). */
export async function listAllTasks(projectKey: string): Promise<TaskSummary[]> {
  const tasks: TaskSummary[] = [];
  let cursor: string | null = null;
  do {
    const query: string = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
    const page = await call(
      `/api/v1/projects/${projectKey}/tasks?limit=${String(MAX_PAGE_LIMIT)}${query}`,
      {},
      taskPageSchema,
    );
    tasks.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  // A task moved during the load can be listed twice (WS-123 section 5).
  return uniqueTasks(tasks);
}

export function createTask(projectKey: string, body: CreateTaskRequest) {
  return call(
    `/api/v1/projects/${projectKey}/tasks`,
    { method: "POST", ...jsonBody(body) },
    taskSchema,
  );
}

export function moveTask(taskId: string, body: MoveTaskRequest) {
  return call(`/api/v1/tasks/${taskId}/move`, { method: "POST", ...jsonBody(body) }, taskSchema);
}

/** One column's tasks, in board order (WS-048 section 4): every page, as the first load. */
export async function listColumnTasks(
  projectKey: string,
  columnId: string,
): Promise<TaskSummary[]> {
  const tasks: TaskSummary[] = [];
  let cursor: string | null = null;
  do {
    const query: string = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
    const page = await call(
      `/api/v1/projects/${projectKey}/tasks?limit=${String(MAX_PAGE_LIMIT)}&columnId=${columnId}${query}`,
      {},
      taskPageSchema,
    );
    tasks.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  // A task moved during the load can be listed twice (WS-123 section 5).
  return uniqueTasks(tasks);
}
