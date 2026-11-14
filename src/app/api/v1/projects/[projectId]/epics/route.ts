import {
  createEpicContract,
  createEpicRequestSchema,
  epicQuerySchema,
  listEpicsContract,
} from "@/lib/schemas/epics";
import { projectParamsSchema } from "@/lib/schemas/projects";
import { json, readJson, readParams, readQuery, route } from "@/server/http/route";
import { createEpic, listEpics } from "@/server/services/epics";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

export const GET = route(listEpicsContract, async (request, context: Context, { actor }) => {
  const { projectId } = await readParams(context.params, projectParamsSchema);
  const query = readQuery(request, epicQuerySchema);

  return json(await listEpics(actor, projectId, query));
});

export const POST = route(createEpicContract, async (request, context: Context, { actor }) => {
  const { projectId } = await readParams(context.params, projectParamsSchema);
  const body = await readJson(request, createEpicRequestSchema);

  return json(await createEpic(actor, projectId, body), 201);
});
