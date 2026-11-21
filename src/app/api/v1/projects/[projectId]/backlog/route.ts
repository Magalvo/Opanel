import { projectParamsSchema } from "@/lib/schemas/projects";
import { backlogQuerySchema, listBacklogContract } from "@/lib/schemas/tasks";
import { json, readParams, readQuery, route } from "@/server/http/route";
import { listBacklog } from "@/server/services/tasks";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

// The project's backlog (WS-101).
export const GET = route(listBacklogContract, async (request, context: Context, { actor }) => {
  const { projectId } = await readParams(context.params, projectParamsSchema);
  const query = readQuery(request, backlogQuerySchema);

  return json(await listBacklog(actor, projectId, query));
});
