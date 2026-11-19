import { ApiFailure, call, callNoContent, jsonBody } from "@/lib/api-client";
import {
  agentPageSchema,
  agentSchema,
  apiTokenListSchema,
  type CreateAgentRequest,
  type CreateApiTokenRequest,
  createdApiTokenSchema,
  type UpdateAgentRequest,
} from "@/lib/schemas/agents";
import { projectPageSchema } from "@/lib/schemas/projects";

// The Agents page's client of `/api/v1/agents` (WS-075, WS-077).

export { ApiFailure };

export const PAGE_SIZE = 50;

export function listAgents(cursor?: string) {
  const query = `limit=${String(PAGE_SIZE)}${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
  return call(`/api/v1/agents?${query}`, {}, agentPageSchema);
}

export function getAgent(agentId: string) {
  return call(`/api/v1/agents/${agentId}`, {}, agentSchema);
}

export function createAgent(body: CreateAgentRequest) {
  return call("/api/v1/agents", { method: "POST", ...jsonBody(body) }, agentSchema);
}

export function updateAgent(agentId: string, body: UpdateAgentRequest) {
  return call(`/api/v1/agents/${agentId}`, { method: "PATCH", ...jsonBody(body) }, agentSchema);
}

export function listTokens(agentId: string) {
  return call(`/api/v1/agents/${agentId}/tokens`, {}, apiTokenListSchema);
}

export function createToken(agentId: string, body: CreateApiTokenRequest) {
  return call(
    `/api/v1/agents/${agentId}/tokens`,
    { method: "POST", ...jsonBody(body) },
    createdApiTokenSchema,
  );
}

export function revokeToken(agentId: string, tokenId: string): Promise<void> {
  return callNoContent(`/api/v1/agents/${agentId}/tokens/${tokenId}`, { method: "DELETE" });
}

export interface ProjectChoice {
  id: string;
  name: string;
  archived: boolean;
}

/** Every project, active then archived, every page of each (WS-077 question 2). */
export async function listAllProjects(): Promise<ProjectChoice[]> {
  const choices: ProjectChoice[] = [];
  for (const archived of [false, true]) {
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ limit: "100" });
      if (archived) query.set("archived", "true");
      if (cursor !== null) query.set("cursor", cursor);
      const page = await call(`/api/v1/projects?${query.toString()}`, {}, projectPageSchema);
      for (const project of page.items) {
        choices.push({ id: project.id, name: project.name, archived });
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
  }
  return choices;
}
