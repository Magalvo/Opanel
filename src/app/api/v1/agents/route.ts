import {
  createAgentContract,
  createAgentRequestSchema,
  listAgentsContract,
} from "@/lib/schemas/agents";
import { paginationQuerySchema } from "@/lib/schemas/pagination";
import { json, readJson, readQuery, route } from "@/server/http/route";
import { createAgent, listAgents } from "@/server/services/agents";

export const dynamic = "force-dynamic";

export const GET = route(listAgentsContract, async (request, _context, { actor }) => {
  const query = readQuery(request, paginationQuerySchema);

  return json(await listAgents(actor, query));
});

export const POST = route(createAgentContract, async (request, _context, { actor }) => {
  const body = await readJson(request, createAgentRequestSchema);

  return json(await createAgent(actor, body), 201);
});
