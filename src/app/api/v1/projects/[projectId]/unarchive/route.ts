import { projectParamsSchema, unarchiveProjectContract } from "@/lib/schemas/projects";
import { json, readParams, route } from "@/server/http/route";
import { unarchiveProject } from "@/server/services/projects";

export const dynamic = "force-dynamic";

export const POST = route(
  unarchiveProjectContract,
  async (_request, context: { params: Promise<unknown> }, { actor }) => {
    const { projectId } = await readParams(context.params, projectParamsSchema);

    return json(await unarchiveProject(actor, projectId));
  },
);
