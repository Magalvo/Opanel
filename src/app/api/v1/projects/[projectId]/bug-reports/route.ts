import { submitBugReportContract, submitBugReportRequestSchema } from "@/lib/schemas/bug-reports";
import { projectParamsSchema } from "@/lib/schemas/projects";
import { json, readJson, readParams, route } from "@/server/http/route";
import { fileBugReport } from "@/server/services/bug-reports";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

// The bug report endpoint (canonical doc 0001 section 5, WS-089): `201` for a new bug,
// `200` for a report counted on an open one.
export const POST = route(submitBugReportContract, async (request, context: Context, { actor }) => {
  const { projectId } = await readParams(context.params, projectParamsSchema);
  const body = await readJson(request, submitBugReportRequestSchema);
  const answer = await fileBugReport(actor, projectId, body);

  return json(answer, answer.outcome === "created" ? 201 : 200);
});
