import { TeamsPage } from "@/components/teams/teams-page";
import { can } from "@/server/auth/actor";
import { requireAccount } from "@/server/auth/session";

export const metadata = { title: "Teams" };

/**
 * The "Teams" page (WS-035). Everyone signed in reads it; only a Manager or Admin gets the
 * controls. The data is read through `/api/v1/teams`, whose write endpoints enforce
 * `teams:manage` themselves, so this check only decides what the page shows.
 */
export default async function TeamsRoute() {
  const { actor } = await requireAccount();

  return <TeamsPage canManage={can(actor, "teams:manage")} />;
}
