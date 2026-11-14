import { moveTaskContract, moveTaskRequestSchema, taskParamsSchema } from "@/lib/schemas/tasks";
import { json, readJson, readParams, route } from "@/server/http/route";
import { moveTask } from "@/server/services/tasks";

export const dynamic = "force-dynamic";

export const POST = route(
  moveTaskContract,
  async (request, context: { params: Promise<unknown> }, { actor }) => {
    const { taskId } = await readParams(context.params, taskParamsSchema);
    const body = await readJson(request, moveTaskRequestSchema);

    return json(await moveTask(actor, taskId, body));
  },
);
