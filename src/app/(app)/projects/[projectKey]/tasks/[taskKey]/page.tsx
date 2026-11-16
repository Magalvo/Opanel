import { TaskDetail } from "@/components/task/task-detail";

import { taskAccess } from "../../task-access";

export const metadata = { title: "Task" };

/** A task as its own page: a direct visit, a reload or a shared link (WS-038). */
export default async function TaskRoute({
  params,
}: {
  params: Promise<{ projectKey: string; taskKey: string }>;
}) {
  const access = await taskAccess(params);
  return <TaskDetail {...access} mode="page" />;
}
