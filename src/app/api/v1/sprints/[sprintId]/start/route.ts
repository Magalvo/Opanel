import {
  sprintParamsSchema,
  startSprintContract,
  startSprintRequestSchema,
} from "@/lib/schemas/sprints";
import { json, readJson, readParams, route } from "@/server/http/route";
import { startSprint } from "@/server/services/sprints";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

export const POST = route(startSprintContract, async (request, context: Context, { actor }) => {
  const { sprintId } = await readParams(context.params, sprintParamsSchema);
  const body = await readJson(request, startSprintRequestSchema);

  return json(await startSprint(actor, sprintId, body));
});
