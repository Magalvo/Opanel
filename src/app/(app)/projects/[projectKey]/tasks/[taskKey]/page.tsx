import { TaskPageView } from "@/components/task/task-page-view";
import { requireAccount } from "@/server/auth/session";

import { loadTask } from "../../../load-task";

export const metadata = { title: "Task" };

/** A task as a page of its own (WS-038): a direct visit, a reload or a shared link. */
export default async function TaskRoute({
  params,
}: Readonly<{ params: Promise<{ projectKey: string; taskKey: string }> }>) {
  const { actor } = await requireAccount();
  const { projectKey, taskKey } = await params;

  return <TaskPageView {...await loadTask(actor, projectKey, taskKey)} />;
}
