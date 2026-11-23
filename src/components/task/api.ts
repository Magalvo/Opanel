import { call, callNoContent, jsonBody } from "@/lib/api-client";
import { commentPageSchema, commentSchema } from "@/lib/schemas/comments";
import { type Epic, epicPageSchema } from "@/lib/schemas/epics";
import { MAX_PAGE_LIMIT } from "@/lib/schemas/pagination";
import { bugReportPageSchema } from "@/lib/schemas/task-bug-reports";
import { taskSchema, type UpdateTaskRequest } from "@/lib/schemas/tasks";

export { listColumns } from "@/components/projects/api";
export { listAllTeams, searchPeople } from "@/components/teams/api";

/** Comments per page (WS-034). */
export const COMMENT_PAGE_SIZE = 50;

function cursorQuery(cursor: string | undefined): string {
  return cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`;
}

export function getTask(key: string) {
  return call(`/api/v1/tasks/${key}`, {}, taskSchema);
}

export function updateTask(key: string, body: UpdateTaskRequest) {
  return call(`/api/v1/tasks/${key}`, { method: "PATCH", ...jsonBody(body) }, taskSchema);
}

/**
 * To the end of a column, or of the backlog for `null`: the column select (WT-03 decision
 * 15, WS-109 section 5).
 */
export function moveTaskTo(key: string, columnId: string | null, version: number) {
  return call(
    `/api/v1/tasks/${key}/move`,
    { method: "POST", ...jsonBody({ columnId, version }) },
    taskSchema,
  );
}

export function deleteTask(key: string): Promise<void> {
  return callNoContent(`/api/v1/tasks/${key}`, { method: "DELETE" });
}

export function listComments(key: string, cursor?: string) {
  return call(
    `/api/v1/tasks/${key}/comments?limit=${String(COMMENT_PAGE_SIZE)}${cursorQuery(cursor)}`,
    {},
    commentPageSchema,
  );
}

export function addComment(key: string, body: string) {
  return call(
    `/api/v1/tasks/${key}/comments`,
    { method: "POST", ...jsonBody({ body }) },
    commentSchema,
  );
}

/**
 * The reports behind a task, newest first (WS-090). No `limit`: the server's default of 10
 * keeps pages small, since a report can be large (WS-091 section 5).
 */
export function listBugReports(key: string, cursor?: string) {
  const query = cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`;
  return call(`/api/v1/tasks/${key}/bug-reports${query}`, {}, bugReportPageSchema);
}

/** Every open epic of the project, for the epic select. */
export async function listOpenEpics(projectKey: string): Promise<Epic[]> {
  const epics: Epic[] = [];
  let cursor: string | undefined;
  do {
    const page = await call(
      `/api/v1/projects/${projectKey}/epics?limit=${String(MAX_PAGE_LIMIT)}${cursorQuery(cursor)}`,
      {},
      epicPageSchema,
    );
    epics.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return epics;
}
