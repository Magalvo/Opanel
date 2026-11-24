import { allTasksQuerySchema, listAllTasksContract } from "@/lib/schemas/tasks";
import { json, readQuery, route } from "@/server/http/route";
import { listAllTasks } from "@/server/services/tasks";

export const dynamic = "force-dynamic";

// The list of tasks across projects (WS-118).
export const GET = route(listAllTasksContract, async (request, _context, { actor }) => {
  const query = readQuery(request, allTasksQuerySchema);

  return json(await listAllTasks(actor, query));
});
