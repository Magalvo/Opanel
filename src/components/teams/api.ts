import { personPageSchema } from "@/lib/schemas/people";
import { teamPageSchema, teamSchema } from "@/lib/schemas/teams";

import { call, failureOf, jsonBody } from "../people/api";

export { ApiFailure } from "../people/api";

export const PAGE_SIZE = 50;
export const SEARCH_SIZE = 20;

export function listTeams(cursor?: string) {
  const query = `limit=${String(PAGE_SIZE)}${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
  return call(`/api/v1/teams?${query}`, {}, teamPageSchema);
}

export function getTeam(teamId: string) {
  return call(`/api/v1/teams/${teamId}`, {}, teamSchema);
}

export function createTeam(name: string) {
  return call("/api/v1/teams", { method: "POST", ...jsonBody({ name }) }, teamSchema);
}

export function renameTeam(teamId: string, name: string) {
  return call(`/api/v1/teams/${teamId}`, { method: "PATCH", ...jsonBody({ name }) }, teamSchema);
}

export function addMember(teamId: string, accountId: string) {
  return call(
    `/api/v1/teams/${teamId}/members`,
    { method: "POST", ...jsonBody({ accountId }) },
    teamSchema,
  );
}

export function searchPeople(text: string) {
  return call(
    `/api/v1/people?limit=${String(SEARCH_SIZE)}&q=${encodeURIComponent(text)}`,
    {},
    personPageSchema,
  );
}

/** Answers 204 with no body, so there is nothing to parse. */
async function remove(url: string): Promise<void> {
  const response = await fetch(url, { method: "DELETE" });
  if (!response.ok) {
    throw await failureOf(response);
  }
}

export function deleteTeam(teamId: string) {
  return remove(`/api/v1/teams/${teamId}`);
}

export function removeMember(teamId: string, accountId: string) {
  return remove(`/api/v1/teams/${teamId}/members/${accountId}`);
}
