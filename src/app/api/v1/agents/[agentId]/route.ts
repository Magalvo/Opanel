import {
  agentIdParamsSchema,
  getAgentContract,
  updateAgentContract,
  updateAgentRequestSchema,
} from "@/lib/schemas/agents";
import { json, readJson, readParams, route } from "@/server/http/route";
import { getAgent, updateAgent } from "@/server/services/agents";

export const dynamic = "force-dynamic";

export const GET = route(
  getAgentContract,
  async (_request, context: { params: Promise<unknown> }, { actor }) => {
    const { agentId } = await readParams(context.params, agentIdParamsSchema);

    return json(await getAgent(actor, agentId));
  },
);

export const PATCH = route(
  updateAgentContract,
  async (request, context: { params: Promise<unknown> }, { actor }) => {
    const { agentId } = await readParams(context.params, agentIdParamsSchema);
    const body = await readJson(request, updateAgentRequestSchema);

    return json(await updateAgent(actor, agentId, body));
  },
);
