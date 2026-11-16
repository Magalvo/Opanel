import { TeamsPage } from "@/components/teams/teams-page";
import { can } from "@/server/auth/actor";
import { requireAccount } from "@/server/auth/session";

export const metadata = { title: "Teams" };

/**
 * The teams list (WS-035). Every signed-in person reads it; only Managers and Admins get the
 * controls. The data is read by the browser through `/api/v1/teams`, which enforces both.
 */
export default async function TeamsRoute() {
  const { actor } = await requireAccount();

  return <TeamsPage canManageTeams={can(actor, "teams:manage")} />;
}
