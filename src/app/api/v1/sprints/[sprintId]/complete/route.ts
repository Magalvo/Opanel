import {
  completeSprintContract,
  completeSprintRequestSchema,
  sprintParamsSchema,
} from "@/lib/schemas/sprints";
import { json, readJson, readParams, route } from "@/server/http/route";
import { completeSprint } from "@/server/services/sprints";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

export const POST = route(completeSprintContract, async (request, context: Context, { actor }) => {
  const { sprintId } = await readParams(context.params, sprintParamsSchema);
  const body = await readJson(request, completeSprintRequestSchema);

  return json(await completeSprint(actor, sprintId, body));
});
