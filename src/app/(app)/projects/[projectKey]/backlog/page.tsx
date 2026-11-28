import { Backlog } from "@/components/backlog/backlog";
import { can } from "@/server/auth/actor";
import { requireAccount } from "@/server/auth/session";

export const metadata = { title: "Backlog" };

/**
 * A project's backlog (WS-109). Everyone signed in reads it; people with `tasks:write` add,
 * reorder and move tasks to the board; with `sprints:manage`, plan and start sprints
 * (WS-144). The layout has already checked the project key.
 */
export default async function BacklogRoute() {
  const { actor } = await requireAccount();
  return (
    <Backlog
      canWriteTasks={can(actor, "tasks:write")}
      canManageSprints={can(actor, "sprints:manage")}
    />
  );
}
