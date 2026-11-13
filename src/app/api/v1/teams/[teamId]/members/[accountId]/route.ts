import { removeTeamMemberContract, teamMemberParamsSchema } from "@/lib/schemas/teams";
import { noContent, readParams, route } from "@/server/http/route";
import { removeTeamMember } from "@/server/services/teams";

export const dynamic = "force-dynamic";

export const DELETE = route(
  removeTeamMemberContract,
  async (_request, context: { params: Promise<unknown> }, { actor }) => {
    const { teamId, accountId } = await readParams(context.params, teamMemberParamsSchema);

    await removeTeamMember(actor, teamId, accountId);
    return noContent();
  },
);
