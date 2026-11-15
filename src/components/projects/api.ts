import { columnListSchema, columnSchema } from "@/lib/schemas/columns";
import { projectPageSchema, projectSchema } from "@/lib/schemas/projects";
import { taskPageSchema, taskSchema } from "@/lib/schemas/tasks";

import { call, failureOf, jsonBody } from "../people/api";

export { ApiFailure } from "../people/api";

export const PAGE_SIZE = 50;

function paged(base: string, cursor?: string): string {
  return `${base}${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
}

export function listProjects(archived: boolean, cursor?: string) {
  const base = `/api/v1/projects?limit=${String(PAGE_SIZE)}${archived ? "&archived=true" : ""}`;
  return call(paged(base, cursor), {}, projectPageSchema);
}

export function createProject(body: {
  key: string;
  name: string;
  description?: string | undefined;
}) {
  return call("/api/v1/projects", { method: "POST", ...jsonBody(body) }, projectSchema);
}

export function updateProject(
  projectId: string,
  body: { name?: string; description?: string; version: number },
) {
  return call(
    `/api/v1/projects/${projectId}`,
    { method: "PATCH", ...jsonBody(body) },
    projectSchema,
  );
}

export function archiveProject(projectId: string, archived: boolean) {
  return call(
    `/api/v1/projects/${projectId}/${archived ? "archive" : "unarchive"}`,
    { method: "POST" },
    projectSchema,
  );
}

export function listColumns(projectId: string) {
  return call(`/api/v1/projects/${projectId}/columns`, {}, columnListSchema);
}

export function addColumn(projectId: string, body: { name: string; category: string }) {
  return call(
    `/api/v1/projects/${projectId}/columns`,
    { method: "POST", ...jsonBody(body) },
    columnSchema,
  );
}

export function updateColumn(
  columnId: string,
  body: { name?: string; category?: string; version: number },
) {
  return call(`/api/v1/columns/${columnId}`, { method: "PATCH", ...jsonBody(body) }, columnSchema);
}

export function moveColumn(
  columnId: string,
  body: { afterColumnId: string | null; version: number },
) {
  return call(
    `/api/v1/columns/${columnId}/move`,
    { method: "POST", ...jsonBody(body) },
    columnSchema,
  );
}

/** Answers 204 with no body. */
export async function deleteColumn(columnId: string): Promise<void> {
  const response = await fetch(`/api/v1/columns/${columnId}`, { method: "DELETE" });
  if (!response.ok) {
    throw await failureOf(response);
  }
}

export function listDeletedTasks(projectId: string, cursor?: string) {
  const base = `/api/v1/projects/${projectId}/tasks?deleted=true&limit=${String(PAGE_SIZE)}`;
  return call(paged(base, cursor), {}, taskPageSchema);
}

export function restoreTask(taskKey: string) {
  return call(`/api/v1/tasks/${taskKey}/restore`, { method: "POST" }, taskSchema);
}
