import { Board } from "@/components/board/board";
import { can } from "@/server/auth/actor";
import { requireAccount } from "@/server/auth/session";

/**
 * A project's board (WS-037). Everyone signed in reads it; people with `tasks:write` add
 * and move tasks. The layout has already checked the project key.
 */
export default async function BoardRoute() {
  const { actor } = await requireAccount();
  return <Board canWriteTasks={can(actor, "tasks:write")} />;
}
