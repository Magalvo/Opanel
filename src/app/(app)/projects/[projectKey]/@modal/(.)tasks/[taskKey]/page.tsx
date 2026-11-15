import { loadTask } from "@/app/(app)/projects/load-task";
import { TaskDialog } from "@/components/task/task-dialog";
import { requireAccount } from "@/server/auth/session";

/** The same task over the board, when it is reached from a card (WS-038 section 1). */
export default async function TaskModalRoute({
  params,
}: Readonly<{ params: Promise<{ projectKey: string; taskKey: string }> }>) {
  const { actor } = await requireAccount();
  const { projectKey, taskKey } = await params;

  return <TaskDialog {...await loadTask(actor, projectKey, taskKey)} />;
}
