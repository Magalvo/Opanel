import {
  deleteSprintContract,
  getSprintContract,
  sprintParamsSchema,
  updateSprintContract,
  updateSprintRequestSchema,
} from "@/lib/schemas/sprints";
import { json, noContent, readJson, readParams, route } from "@/server/http/route";
import { deleteSprint, getSprint, updateSprint } from "@/server/services/sprints";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

export const GET = route(getSprintContract, async (_request, context: Context, { actor }) => {
  const { sprintId } = await readParams(context.params, sprintParamsSchema);

  return json(await getSprint(actor, sprintId));
});

export const PATCH = route(updateSprintContract, async (request, context: Context, { actor }) => {
  const { sprintId } = await readParams(context.params, sprintParamsSchema);
  const body = await readJson(request, updateSprintRequestSchema);

  return json(await updateSprint(actor, sprintId, body));
});

export const DELETE = route(deleteSprintContract, async (_request, context: Context, { actor }) => {
  const { sprintId } = await readParams(context.params, sprintParamsSchema);
  await deleteSprint(actor, sprintId);

  return noContent();
});
