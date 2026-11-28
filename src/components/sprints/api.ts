// The sprint endpoints the UI calls (WS-140, WS-142, WS-144): the same `/api/v1` agents use.
import { listSprints } from "@/components/task/api";
import { call, callNoContent, jsonBody } from "@/lib/api-client";
import { MAX_PAGE_LIMIT } from "@/lib/schemas/pagination";
import {
  completedSprintSchema,
  type CompleteSprintRequest,
  type CreateSprintRequest,
  type Sprint,
  sprintPageSchema,
  sprintSchema,
  type UpdateSprintRequest,
} from "@/lib/schemas/sprints";
import { taskPageSchema } from "@/lib/schemas/tasks";

export { listOpenSprints, listSprints } from "@/components/task/api";

/** Every completed sprint of the project, by start date, every page (WT-10 question 9). */
export async function listCompletedSprints(projectKey: string): Promise<Sprint[]> {
  const sprints: Sprint[] = [];
  let cursor: string | null = null;
  do {
    const after: string = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
    const page = await call(
      `/api/v1/projects/${projectKey}/sprints?limit=${String(MAX_PAGE_LIMIT)}&state=completed${after}`,
      {},
      sprintPageSchema,
    );
    sprints.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return sprints;
}

/** Every sprint of the project, for a new sprint's defaults (section 6). */
export function listAllSprints(projectKey: string): Promise<Sprint[]> {
  return listSprints(projectKey);
}

/** Whether the board lists any task: its first page (section 3). */
export async function boardHasTasks(projectKey: string): Promise<boolean> {
  const page = await call(`/api/v1/projects/${projectKey}/tasks?limit=1`, {}, taskPageSchema);
  return page.items.length > 0;
}

export function createSprint(projectKey: string, body: CreateSprintRequest) {
  return call(
    `/api/v1/projects/${projectKey}/sprints`,
    { method: "POST", ...jsonBody(body) },
    sprintSchema,
  );
}

export function updateSprint(sprintId: string, body: UpdateSprintRequest) {
  return call(`/api/v1/sprints/${sprintId}`, { method: "PATCH", ...jsonBody(body) }, sprintSchema);
}

export function deleteSprint(sprintId: string): Promise<void> {
  return callNoContent(`/api/v1/sprints/${sprintId}`, { method: "DELETE" });
}

export function startSprint(sprintId: string, version: number) {
  return call(
    `/api/v1/sprints/${sprintId}/start`,
    { method: "POST", ...jsonBody({ version }) },
    sprintSchema,
  );
}

export function completeSprint(sprintId: string, body: CompleteSprintRequest) {
  return call(
    `/api/v1/sprints/${sprintId}/complete`,
    { method: "POST", ...jsonBody(body) },
    completedSprintSchema,
  );
}
