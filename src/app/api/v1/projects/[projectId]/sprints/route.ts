import { projectParamsSchema } from "@/lib/schemas/projects";
import {
  createSprintContract,
  createSprintRequestSchema,
  listSprintsContract,
  sprintQuerySchema,
} from "@/lib/schemas/sprints";
import { json, readJson, readParams, readQuery, route } from "@/server/http/route";
import { createSprint, listSprints } from "@/server/services/sprints";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

export const GET = route(listSprintsContract, async (request, context: Context, { actor }) => {
  const { projectId } = await readParams(context.params, projectParamsSchema);
  const query = readQuery(request, sprintQuerySchema);

  return json(await listSprints(actor, projectId, query));
});

export const POST = route(createSprintContract, async (request, context: Context, { actor }) => {
  const { projectId } = await readParams(context.params, projectParamsSchema);
  const body = await readJson(request, createSprintRequestSchema);

  return json(await createSprint(actor, projectId, body), 201);
});
