import { projectParamsSchema } from "@/lib/schemas/projects";
import {
  getTriageContract,
  updateTriageContract,
  updateTriageRequestSchema,
} from "@/lib/schemas/triage";
import { json, readJson, readParams, route } from "@/server/http/route";
import { getTriage, updateTriage } from "@/server/services/triage";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

export const GET = route(getTriageContract, async (_request, context: Context, { actor }) => {
  const { projectId } = await readParams(context.params, projectParamsSchema);

  return json(await getTriage(actor, projectId));
});

export const PATCH = route(updateTriageContract, async (request, context: Context, { actor }) => {
  const { projectId } = await readParams(context.params, projectParamsSchema);
  const body = await readJson(request, updateTriageRequestSchema);

  return json(await updateTriage(actor, projectId, body));
});
