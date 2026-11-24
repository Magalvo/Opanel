import { activityQuerySchema, listActivityContract } from "@/lib/schemas/activity";
import { taskParamsSchema } from "@/lib/schemas/tasks";
import { json, readParams, readQuery, route } from "@/server/http/route";
import { listActivity } from "@/server/services/activity";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

// A task's history and comments in one list (WS-117).
export const GET = route(listActivityContract, async (request, context: Context, { actor }) => {
  const { taskId } = await readParams(context.params, taskParamsSchema);
  const query = readQuery(request, activityQuerySchema);

  return json(await listActivity(actor, taskId, query));
});
