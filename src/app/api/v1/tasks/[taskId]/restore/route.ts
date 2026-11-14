import { restoreTaskContract, taskParamsSchema } from "@/lib/schemas/tasks";
import { json, readParams, route } from "@/server/http/route";
import { restoreTask } from "@/server/services/tasks";

export const dynamic = "force-dynamic";

export const POST = route(
  restoreTaskContract,
  async (_request, context: { params: Promise<unknown> }, { actor }) => {
    const { taskId } = await readParams(context.params, taskParamsSchema);

    return json(await restoreTask(actor, taskId));
  },
);
