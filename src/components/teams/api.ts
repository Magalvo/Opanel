import { call, callNoContent, jsonBody } from "@/lib/api-client";
import { personPageSchema } from "@/lib/schemas/people";
import { teamPageSchema, teamSchema, type TeamSummary } from "@/lib/schemas/teams";

export const PAGE_SIZE = 50;

/** How many people a search offers at most. */
export const SEARCH_LIMIT = 20;

export function listTeams(cursor?: string) {
  const query = `limit=${String(PAGE_SIZE)}${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
  return call(`/api/v1/teams?${query}`, {}, teamPageSchema);
}

/** Every team, for the team select (a small list). */
export async function listAllTeams(): Promise<TeamSummary[]> {
  const teams: TeamSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await listTeams(cursor);
    teams.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return teams;
}

export function createTeam(name: string) {
  return call("/api/v1/teams", { method: "POST", ...jsonBody({ name }) }, teamSchema);
}

export function getTeam(teamId: string) {
  return call(`/api/v1/teams/${teamId}`, {}, teamSchema);
}

export function renameTeam(teamId: string, name: string) {
  return call(`/api/v1/teams/${teamId}`, { method: "PATCH", ...jsonBody({ name }) }, teamSchema);
}

export function deleteTeam(teamId: string): Promise<void> {
  return callNoContent(`/api/v1/teams/${teamId}`, { method: "DELETE" });
}

export function addMember(teamId: string, accountId: string) {
  return call(
    `/api/v1/teams/${teamId}/members`,
    { method: "POST", ...jsonBody({ accountId }) },
    teamSchema,
  );
}

export function removeMember(teamId: string, accountId: string): Promise<void> {
  return callNoContent(`/api/v1/teams/${teamId}/members/${accountId}`, { method: "DELETE" });
}

/** People whose name starts with `q` (WT-03 decision 17). */
export function searchPeople(q: string) {
  return call(
    `/api/v1/people?q=${encodeURIComponent(q)}&limit=${String(SEARCH_LIMIT)}`,
    {},
    personPageSchema,
  );
}
