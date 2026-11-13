import { paginationQuerySchema } from "@/lib/schemas/pagination";
import {
  createTeamContract,
  createTeamRequestSchema,
  listTeamsContract,
} from "@/lib/schemas/teams";
import { json, readJson, readQuery, route } from "@/server/http/route";
import { createTeam, listTeams } from "@/server/services/teams";

export const dynamic = "force-dynamic";

export const GET = route(listTeamsContract, async (request, _context, { actor }) => {
  const query = readQuery(request, paginationQuerySchema);

  return json(await listTeams(actor, query));
});

export const POST = route(createTeamContract, async (request, _context, { actor }) => {
  const body = await readJson(request, createTeamRequestSchema);

  return json(await createTeam(actor, body), 201);
});
