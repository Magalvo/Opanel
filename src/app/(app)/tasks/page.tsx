import { TaskList } from "@/components/task-list/task-list";
import { requireAccount } from "@/server/auth/session";

export const metadata = { title: "Tasks" };

/**
 * The list view (WS-130): the tasks of every project the viewer may read. Everyone signed
 * in opens it; `GET /api/v1/tasks` applies `tasks:read` and project restrictions.
 */
export default async function TasksRoute() {
  await requireAccount();
  return <TaskList />;
}
