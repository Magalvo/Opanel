import { TaskDetail } from "@/components/task/task-detail";
import { TaskDialog } from "@/components/task/task-dialog";

import { taskAccess } from "../../../task-access";

/**
 * A task opened from the board: the same screen, as a dialog over the board, at the task's
 * own URL (WS-038, intercepting route).
 */
export default async function TaskDialogRoute({
  params,
}: {
  params: Promise<{ projectKey: string; taskKey: string }>;
}) {
  const access = await taskAccess(params);
  return (
    <TaskDialog taskKey={access.taskKey}>
      <TaskDetail {...access} mode="dialog" />
    </TaskDialog>
  );
}
