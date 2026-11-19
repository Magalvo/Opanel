import { apiTokenParamsSchema, revokeApiTokenContract } from "@/lib/schemas/agents";
import { noContent, readParams, route } from "@/server/http/route";
import { revokeApiToken } from "@/server/services/agents";

export const dynamic = "force-dynamic";

export const DELETE = route(
  revokeApiTokenContract,
  async (_request, context: { params: Promise<unknown> }, { actor }) => {
    const { agentId, tokenId } = await readParams(context.params, apiTokenParamsSchema);
    await revokeApiToken(actor, agentId, tokenId);

    return noContent();
  },
);
