import { call, callNoContent, jsonBody } from "@/lib/api-client";
import { activityPageSchema } from "@/lib/schemas/activity";
import { commentSchema } from "@/lib/schemas/comments";
import { type Epic, epicPageSchema } from "@/lib/schemas/epics";
import { MAX_PAGE_LIMIT } from "@/lib/schemas/pagination";
import { type Sprint, sprintPageSchema } from "@/lib/schemas/sprints";
import { bugReportPageSchema } from "@/lib/schemas/task-bug-reports";
import type { TaskLinkRequest } from "@/lib/schemas/task-links";
import { taskListItemPageSchema, taskSchema, type UpdateTaskRequest } from "@/lib/schemas/tasks";

export { listColumns } from "@/components/projects/api";
export { listAllTeams, searchPeople } from "@/components/teams/api";

/** Activity items per page (WS-119). */
export const ACTIVITY_PAGE_SIZE = 50;

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

/** A task's comments and changes, oldest first (WS-117, WS-119). */
export function listActivity(key: string, cursor?: string) {
  return call(
    `/api/v1/tasks/${key}/activity?limit=${String(ACTIVITY_PAGE_SIZE)}${cursorQuery(cursor)}`,
    {},
    activityPageSchema,
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

/** Every item of a paged list, read `MAX_PAGE_LIMIT` at a time; `query` follows `limit`. */
async function everyPage<Item>(
  path: string,
  query: string,
  schema: { parse: (value: unknown) => { items: Item[]; nextCursor: string | null } },
): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | undefined;
  do {
    const page = await call(
      `${path}?limit=${String(MAX_PAGE_LIMIT)}${query}${cursorQuery(cursor)}`,
      {},
      schema,
    );
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return items;
}

/** Every open epic of the project, for the epic select. */
export function listOpenEpics(projectKey: string): Promise<Epic[]> {
  return everyPage(`/api/v1/projects/${projectKey}/epics`, "", epicPageSchema);
}

/**
 * Every sprint of the project, by start date (WS-143): the active and planned ones for the
 * task page's select, or all of them for the filter's menu.
 */
export function listSprints(projectKey: string, open = false): Promise<Sprint[]> {
  const states = open ? "&state=active&state=planned" : "";
  return everyPage(`/api/v1/projects/${projectKey}/sprints`, states, sprintPageSchema);
}

/** The active and planned sprints, for the task page's select (WS-143 section 2). */
export function listOpenSprints(projectKey: string): Promise<Sprint[]> {
  return listSprints(projectKey, true);
}

/** How many tasks "Set parent" and "Add link" offer at a time (WS-135, WS-136). */
export const TASK_SEARCH_SIZE = 20;

/** The most recently updated tasks matching `q`, with the given filters. */
function findTasks(q: string, filters: Record<string, string>) {
  const query = new URLSearchParams({
    limit: String(TASK_SEARCH_SIZE),
    sort: "-updated",
    ...filters,
    q,
  });
  return call(`/api/v1/tasks?${query.toString()}`, {}, taskListItemPageSchema);
}

/**
 * Tasks of the project that may become a parent: not sub-tasks themselves, found by key or
 * words (WS-135 section 3).
 */
export function searchParents(projectKey: string, q: string) {
  return findTasks(q, { projectId: projectKey, parentId: "none" });
}

/** Tasks of every project the caller may reach, found by key or words (WS-136 section 3). */
export function searchTasks(q: string) {
  return findTasks(q, {});
}

/** Links the task to another; answers the task with its new links (WS-136 section 3). */
export function addLink(key: string, body: TaskLinkRequest) {
  return call(`/api/v1/tasks/${key}/links`, { method: "POST", ...jsonBody(body) }, taskSchema);
}

/** Removes the link named as the task reads it (WS-136 section 4). */
export function removeLink(key: string, link: TaskLinkRequest): Promise<void> {
  const query = new URLSearchParams({
    type: link.type,
    direction: link.direction,
    taskId: link.taskId,
  });
  return callNoContent(`/api/v1/tasks/${key}/links?${query.toString()}`, { method: "DELETE" });
}
