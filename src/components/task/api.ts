import { commentPageSchema, commentSchema } from "@/lib/schemas/comments";
import { epicPageSchema } from "@/lib/schemas/epics";
import { taskSchema } from "@/lib/schemas/tasks";
import { teamPageSchema } from "@/lib/schemas/teams";

import { call, failureOf, jsonBody } from "../people/api";

export { moveTask } from "../board/api";
export { listColumns } from "../board/api";
export { ApiFailure } from "../people/api";
export { searchPeople } from "../teams/api";

export const PAGE_SIZE = 100;
export const COMMENTS_PAGE_SIZE = 50;

/** Every page of a list that is small by nature (teams, epics): the pages are followed. */
async function allPages<Item>(
  urlFor: (cursor: string | undefined) => string,
  read: (url: string) => Promise<{ items: Item[]; nextCursor: string | null }>,
): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | undefined;
  do {
    const page = await read(urlFor(cursor));
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return items;
}

function withCursor(base: string, cursor: string | undefined): string {
  return cursor === undefined ? base : `${base}&cursor=${encodeURIComponent(cursor)}`;
}

export function listAllTeams() {
  return allPages(
    (cursor) => withCursor(`/api/v1/teams?limit=${String(PAGE_SIZE)}`, cursor),
    (url) => call(url, {}, teamPageSchema),
  );
}

export function listOpenEpics(projectId: string) {
  return allPages(
    (cursor) =>
      withCursor(`/api/v1/projects/${projectId}/epics?limit=${String(PAGE_SIZE)}`, cursor),
    (url) => call(url, {}, epicPageSchema),
  );
}

export interface TaskChanges {
  title?: string;
  type?: string;
  description?: string;
  assigneeTeamId?: string | null;
  assigneeAccountId?: string | null;
  epicId?: string | null;
  version: number;
}

export function updateTask(taskKey: string, body: TaskChanges) {
  return call(`/api/v1/tasks/${taskKey}`, { method: "PATCH", ...jsonBody(body) }, taskSchema);
}

/** Answers 204 with no body. */
export async function deleteTask(taskKey: string): Promise<void> {
  const response = await fetch(`/api/v1/tasks/${taskKey}`, { method: "DELETE" });
  if (!response.ok) {
    throw await failureOf(response);
  }
}

export function listComments(taskKey: string, cursor?: string) {
  const base = `/api/v1/tasks/${taskKey}/comments?limit=${String(COMMENTS_PAGE_SIZE)}`;
  return call(withCursor(base, cursor), {}, commentPageSchema);
}

export function addComment(taskKey: string, body: string) {
  return call(
    `/api/v1/tasks/${taskKey}/comments`,
    { method: "POST", ...jsonBody({ body }) },
    commentSchema,
  );
}
