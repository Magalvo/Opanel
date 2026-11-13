import { archiveProjectContract, projectParamsSchema } from "@/lib/schemas/projects";
import { json, readParams, route } from "@/server/http/route";
import { archiveProject } from "@/server/services/projects";

export const dynamic = "force-dynamic";

export const POST = route(
  archiveProjectContract,
  async (_request, context: { params: Promise<unknown> }, { actor }) => {
    const { projectId } = await readParams(context.params, projectParamsSchema);

    return json(await archiveProject(actor, projectId));
  },
);
