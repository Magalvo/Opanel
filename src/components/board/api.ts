import { columnListSchema } from "@/lib/schemas/columns";
import { taskPageSchema, taskSchema, type TaskSummary } from "@/lib/schemas/tasks";

import { call, jsonBody } from "../people/api";

export { ApiFailure } from "../people/api";

export const PAGE_SIZE = 100;

export function listColumns(projectId: string) {
  return call(`/api/v1/projects/${projectId}/columns`, {}, columnListSchema);
}

/** Every task of the project, in board order: the pages are followed until the last one. */
export async function listAllTasks(projectId: string): Promise<TaskSummary[]> {
  const tasks: TaskSummary[] = [];
  let cursor: string | undefined;
  do {
    const query = `limit=${String(PAGE_SIZE)}${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
    const page = await call(`/api/v1/projects/${projectId}/tasks?${query}`, {}, taskPageSchema);
    tasks.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return tasks;
}

export function createTask(projectId: string, body: { title: string; columnId: string }) {
  return call(
    `/api/v1/projects/${projectId}/tasks`,
    { method: "POST", ...jsonBody(body) },
    taskSchema,
  );
}

export interface MoveBody {
  columnId: string;
  afterTaskId?: string | undefined;
  beforeTaskId?: string | undefined;
  version: number;
}

export function moveTask(taskKey: string, body: MoveBody) {
  return call(`/api/v1/tasks/${taskKey}/move`, { method: "POST", ...jsonBody(body) }, taskSchema);
}
