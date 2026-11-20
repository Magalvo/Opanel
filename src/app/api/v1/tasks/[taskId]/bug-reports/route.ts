import { bugReportListQuerySchema, listBugReportsContract } from "@/lib/schemas/task-bug-reports";
import { taskParamsSchema } from "@/lib/schemas/tasks";
import { json, readParams, readQuery, route } from "@/server/http/route";
import { listBugReports } from "@/server/services/bug-reports";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

// The reports behind a task, newest first (WT-06 decision 15, WS-090).
export const GET = route(listBugReportsContract, async (request, context: Context, { actor }) => {
  const { taskId } = await readParams(context.params, taskParamsSchema);
  const query = readQuery(request, bugReportListQuerySchema);

  return json(await listBugReports(actor, taskId, query));
});
