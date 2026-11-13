import {
  createColumnContract,
  createColumnRequestSchema,
  listColumnsContract,
} from "@/lib/schemas/columns";
import { projectParamsSchema } from "@/lib/schemas/projects";
import { json, readJson, readParams, route } from "@/server/http/route";
import { createColumn, listColumns } from "@/server/services/columns";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

export const GET = route(listColumnsContract, async (_request, context: Context, { actor }) => {
  const { projectId } = await readParams(context.params, projectParamsSchema);

  return json(await listColumns(actor, projectId));
});

export const POST = route(createColumnContract, async (request, context: Context, { actor }) => {
  const { projectId } = await readParams(context.params, projectParamsSchema);
  const body = await readJson(request, createColumnRequestSchema);

  return json(await createColumn(actor, projectId, body), 201);
});
