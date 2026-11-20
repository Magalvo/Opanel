import { call, callNoContent, jsonBody } from "@/lib/api-client";
import {
  type ColumnCategory,
  columnListSchema,
  columnSchema,
  type CreateColumnRequest,
  type UpdateColumnRequest,
} from "@/lib/schemas/columns";
import {
  type CreateProjectRequest,
  projectPageSchema,
  projectSchema,
  type UpdateProjectRequest,
} from "@/lib/schemas/projects";
import { taskPageSchema, taskSchema } from "@/lib/schemas/tasks";
import { triageSettingsSchema, type UpdateTriageRequest } from "@/lib/schemas/triage";

export const PAGE_SIZE = 50;

export const CATEGORY_LABELS: Record<ColumnCategory, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

function pageQuery(cursor: string | undefined): string {
  return `limit=${String(PAGE_SIZE)}${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
}

export function listProjects(archived: boolean, cursor?: string) {
  const query = `${pageQuery(undefined)}${archived ? "&archived=true" : ""}${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
  return call(`/api/v1/projects?${query}`, {}, projectPageSchema);
}

export function createProject(body: CreateProjectRequest) {
  return call("/api/v1/projects", { method: "POST", ...jsonBody(body) }, projectSchema);
}

export function getProject(key: string) {
  return call(`/api/v1/projects/${key}`, {}, projectSchema);
}

export function updateProject(key: string, body: UpdateProjectRequest) {
  return call(`/api/v1/projects/${key}`, { method: "PATCH", ...jsonBody(body) }, projectSchema);
}

export function setArchived(key: string, archived: boolean) {
  return call(
    `/api/v1/projects/${key}/${archived ? "archive" : "unarchive"}`,
    { method: "POST" },
    projectSchema,
  );
}

export function listColumns(key: string) {
  return call(`/api/v1/projects/${key}/columns`, {}, columnListSchema);
}

export function createColumn(key: string, body: CreateColumnRequest) {
  return call(
    `/api/v1/projects/${key}/columns`,
    { method: "POST", ...jsonBody(body) },
    columnSchema,
  );
}

export function updateColumn(columnId: string, body: UpdateColumnRequest) {
  return call(`/api/v1/columns/${columnId}`, { method: "PATCH", ...jsonBody(body) }, columnSchema);
}

export function moveColumn(columnId: string, afterColumnId: string | null, version: number) {
  return call(
    `/api/v1/columns/${columnId}/move`,
    { method: "POST", ...jsonBody({ afterColumnId, version }) },
    columnSchema,
  );
}

export function deleteColumn(columnId: string): Promise<void> {
  return callNoContent(`/api/v1/columns/${columnId}`, { method: "DELETE" });
}

export function listDeletedTasks(key: string, cursor?: string) {
  return call(
    `/api/v1/projects/${key}/tasks?${pageQuery(cursor)}&deleted=true`,
    {},
    taskPageSchema,
  );
}

export function restoreTask(taskId: string) {
  return call(`/api/v1/tasks/${taskId}/restore`, { method: "POST" }, taskSchema);
}

/** A project's triage settings (WS-087). */
export function getTriage(key: string) {
  return call(`/api/v1/projects/${key}/triage`, {}, triageSettingsSchema);
}

export function updateTriage(key: string, body: UpdateTriageRequest) {
  return call(
    `/api/v1/projects/${key}/triage`,
    { method: "PATCH", ...jsonBody(body) },
    triageSettingsSchema,
  );
}
