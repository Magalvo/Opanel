import { call, jsonBody } from "@/lib/api-client";
import {
  type CreateEpicRequest,
  epicPageSchema,
  epicSchema,
  type UpdateEpicRequest,
} from "@/lib/schemas/epics";

export const EPIC_PAGE_SIZE = 50;

/** Which epics the list shows; `open` is the API's default too. */
export type EpicsShow = "open" | "closed" | "all";

export function listEpics(projectKey: string, show: EpicsShow, cursor?: string) {
  const more = cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`;
  return call(
    `/api/v1/projects/${projectKey}/epics?limit=${String(EPIC_PAGE_SIZE)}&status=${show}${more}`,
    {},
    epicPageSchema,
  );
}

export function createEpic(projectKey: string, body: CreateEpicRequest) {
  return call(
    `/api/v1/projects/${projectKey}/epics`,
    { method: "POST", ...jsonBody(body) },
    epicSchema,
  );
}

export function updateEpic(epicId: string, body: UpdateEpicRequest) {
  return call(`/api/v1/epics/${epicId}`, { method: "PATCH", ...jsonBody(body) }, epicSchema);
}
