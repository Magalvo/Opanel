import {
  getTaskContract,
  taskParamsSchema,
  updateTaskContract,
  updateTaskRequestSchema,
} from "@/lib/schemas/tasks";
import { json, readJson, readParams, route } from "@/server/http/route";
import { getTask, updateTask } from "@/server/services/tasks";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

export const GET = route(getTaskContract, async (_request, context: Context, { actor }) => {
  const { taskId } = await readParams(context.params, taskParamsSchema);

  return json(await getTask(actor, taskId));
});

export const PATCH = route(updateTaskContract, async (request, context: Context, { actor }) => {
  const { taskId } = await readParams(context.params, taskParamsSchema);
  const body = await readJson(request, updateTaskRequestSchema);

  return json(await updateTask(actor, taskId, body));
});
