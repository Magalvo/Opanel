import { epicPageSchema, epicSchema } from "@/lib/schemas/epics";

import { call, jsonBody } from "../people/api";

export { ApiFailure } from "../people/api";

export const PAGE_SIZE = 50;

export type EpicFilter = "open" | "closed" | "all";

export function listEpics(projectId: string, filter: EpicFilter, cursor?: string) {
  const base = `/api/v1/projects/${projectId}/epics?limit=${String(PAGE_SIZE)}&status=${filter}`;
  const url = cursor === undefined ? base : `${base}&cursor=${encodeURIComponent(cursor)}`;
  return call(url, {}, epicPageSchema);
}

export interface NewEpic {
  title: string;
  description?: string;
  startDate?: string;
  targetDate?: string;
}

export function createEpic(projectId: string, body: NewEpic) {
  return call(
    `/api/v1/projects/${projectId}/epics`,
    { method: "POST", ...jsonBody(body) },
    epicSchema,
  );
}

export interface EpicChanges {
  title?: string;
  description?: string;
  startDate?: string | null;
  targetDate?: string | null;
  status?: "open" | "closed";
  version: number;
}

export function updateEpic(epicId: string, body: EpicChanges) {
  return call(`/api/v1/epics/${epicId}`, { method: "PATCH", ...jsonBody(body) }, epicSchema);
}
