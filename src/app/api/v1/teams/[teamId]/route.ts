import {
  deleteTeamContract,
  getTeamContract,
  teamIdParamsSchema,
  updateTeamContract,
  updateTeamRequestSchema,
} from "@/lib/schemas/teams";
import { json, noContent, readJson, readParams, route } from "@/server/http/route";
import { deleteTeam, getTeam, renameTeam } from "@/server/services/teams";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

export const GET = route(getTeamContract, async (_request, context: Context, { actor }) => {
  const { teamId } = await readParams(context.params, teamIdParamsSchema);

  return json(await getTeam(actor, teamId));
});

export const PATCH = route(updateTeamContract, async (request, context: Context, { actor }) => {
  const { teamId } = await readParams(context.params, teamIdParamsSchema);
  const body = await readJson(request, updateTeamRequestSchema);

  return json(await renameTeam(actor, teamId, body));
});

export const DELETE = route(deleteTeamContract, async (_request, context: Context, { actor }) => {
  const { teamId } = await readParams(context.params, teamIdParamsSchema);

  await deleteTeam(actor, teamId);
  return noContent();
});
