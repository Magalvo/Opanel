import {
  getProjectContract,
  projectParamsSchema,
  updateProjectContract,
  updateProjectRequestSchema,
} from "@/lib/schemas/projects";
import { json, readJson, readParams, route } from "@/server/http/route";
import { getProject, updateProject } from "@/server/services/projects";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

export const GET = route(getProjectContract, async (_request, context: Context, { actor }) => {
  const { projectId } = await readParams(context.params, projectParamsSchema);

  return json(await getProject(actor, projectId));
});

export const PATCH = route(updateProjectContract, async (request, context: Context, { actor }) => {
  const { projectId } = await readParams(context.params, projectParamsSchema);
  const body = await readJson(request, updateProjectRequestSchema);

  return json(await updateProject(actor, projectId, body));
});
