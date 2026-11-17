import { projectEventsContract } from "@/lib/schemas/events";
import { projectParamsSchema } from "@/lib/schemas/projects";
import { openEventStream } from "@/server/http/event-stream";
import { readParams, route } from "@/server/http/route";
import { getProject } from "@/server/services/projects";

// A stream per request, never prerendered or cached (WS-047).
export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

export const GET = route(projectEventsContract, async (request, context: Context, auth) => {
  const { projectId } = await readParams(context.params, projectParamsSchema);
  const project = await getProject(auth.actor, projectId);

  return openEventStream({ request, projectId: project.id, account: auth.account.id });
});
