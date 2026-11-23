import {
  createLabelContract,
  createLabelRequestSchema,
  listLabelsContract,
} from "@/lib/schemas/labels";
import { projectParamsSchema } from "@/lib/schemas/projects";
import { json, readJson, readParams, route } from "@/server/http/route";
import { createLabel, listLabels } from "@/server/services/labels";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

export const GET = route(listLabelsContract, async (_request, context: Context, { actor }) => {
  const { projectId } = await readParams(context.params, projectParamsSchema);

  return json(await listLabels(actor, projectId));
});

export const POST = route(createLabelContract, async (request, context: Context, { actor }) => {
  const { projectId } = await readParams(context.params, projectParamsSchema);
  const body = await readJson(request, createLabelRequestSchema);

  return json(await createLabel(actor, projectId, body), 201);
});
