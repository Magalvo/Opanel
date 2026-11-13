import { projectParamsSchema } from "@/lib/schemas/projects";
import {
  createTaskContract,
  createTaskRequestSchema,
  listTasksContract,
  taskListQuerySchema,
} from "@/lib/schemas/tasks";
import { json, readJson, readParams, readQuery, route } from "@/server/http/route";
import { createTask, listTasks } from "@/server/services/tasks";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

export const GET = route(listTasksContract, async (request, context: Context, { actor }) => {
  const { projectId } = await readParams(context.params, projectParamsSchema);
  const query = readQuery(request, taskListQuerySchema);

  return json(await listTasks(actor, projectId, query));
});

export const POST = route(createTaskContract, async (request, context: Context, { actor }) => {
  const { projectId } = await readParams(context.params, projectParamsSchema);
  const body = await readJson(request, createTaskRequestSchema);

  return json(await createTask(actor, projectId, body), 201);
});
