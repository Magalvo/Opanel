import {
  agentIdParamsSchema,
  createApiTokenContract,
  createApiTokenRequestSchema,
  listApiTokensContract,
} from "@/lib/schemas/agents";
import { json, readJson, readParams, route } from "@/server/http/route";
import { createApiToken, listApiTokens } from "@/server/services/agents";

export const dynamic = "force-dynamic";

export const GET = route(
  listApiTokensContract,
  async (_request, context: { params: Promise<unknown> }, { actor }) => {
    const { agentId } = await readParams(context.params, agentIdParamsSchema);

    return json(await listApiTokens(actor, agentId));
  },
);

export const POST = route(
  createApiTokenContract,
  async (request, context: { params: Promise<unknown> }, { actor }) => {
    const { agentId } = await readParams(context.params, agentIdParamsSchema);
    const body = await readJson(request, createApiTokenRequestSchema);

    return json(await createApiToken(actor, agentId, body), 201);
  },
);
