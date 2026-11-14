import {
  epicParamsSchema,
  getEpicContract,
  updateEpicContract,
  updateEpicRequestSchema,
} from "@/lib/schemas/epics";
import { json, readJson, readParams, route } from "@/server/http/route";
import { getEpic, updateEpic } from "@/server/services/epics";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

export const GET = route(getEpicContract, async (_request, context: Context, { actor }) => {
  const { epicId } = await readParams(context.params, epicParamsSchema);

  return json(await getEpic(actor, epicId));
});

export const PATCH = route(updateEpicContract, async (request, context: Context, { actor }) => {
  const { epicId } = await readParams(context.params, epicParamsSchema);
  const body = await readJson(request, updateEpicRequestSchema);

  return json(await updateEpic(actor, epicId, body));
});
