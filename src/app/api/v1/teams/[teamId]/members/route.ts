import {
  addMemberRequestSchema,
  addTeamMemberContract,
  teamIdParamsSchema,
} from "@/lib/schemas/teams";
import { json, readJson, readParams, route } from "@/server/http/route";
import { addTeamMember } from "@/server/services/teams";

export const dynamic = "force-dynamic";

export const POST = route(
  addTeamMemberContract,
  async (request, context: { params: Promise<unknown> }, { actor }) => {
    const { teamId } = await readParams(context.params, teamIdParamsSchema);
    const body = await readJson(request, addMemberRequestSchema);

    return json(await addTeamMember(actor, teamId, body));
  },
);
