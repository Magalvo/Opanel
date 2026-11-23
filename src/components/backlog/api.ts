import { call } from "@/lib/api-client";
import { MAX_PAGE_LIMIT } from "@/lib/schemas/pagination";
import { taskPageSchema, type TaskSummary } from "@/lib/schemas/tasks";

/** Every task of the project's backlog, in backlog order: every page (WS-109 section 2). */
export async function listAllBacklog(projectKey: string): Promise<TaskSummary[]> {
  const tasks: TaskSummary[] = [];
  let cursor: string | null = null;
  do {
    const query: string = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
    const page = await call(
      `/api/v1/projects/${projectKey}/backlog?limit=${String(MAX_PAGE_LIMIT)}${query}`,
      {},
      taskPageSchema,
    );
    tasks.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return tasks;
}
