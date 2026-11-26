import {
  addTaskLinkContract,
  removeTaskLinkContract,
  taskLinkQuerySchema,
  taskLinkRequestSchema,
} from "@/lib/schemas/task-links";
import { taskParamsSchema } from "@/lib/schemas/tasks";
import { json, noContent, readJson, readParams, readQuery, route } from "@/server/http/route";
import { addTaskLink, removeTaskLink } from "@/server/services/task-links";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

export const POST = route(addTaskLinkContract, async (request, context: Context, { actor }) => {
  const { taskId } = await readParams(context.params, taskParamsSchema);
  const body = await readJson(request, taskLinkRequestSchema);

  return json(await addTaskLink(actor, taskId, body));
});

export const DELETE = route(
  removeTaskLinkContract,
  async (request, context: Context, { actor }) => {
    const { taskId } = await readParams(context.params, taskParamsSchema);
    const query = readQuery(request, taskLinkQuerySchema);

    await removeTaskLink(actor, taskId, query);
    return noContent();
  },
);
