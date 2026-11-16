import { notFound } from "next/navigation";
import { z } from "zod";

import { TeamPage } from "@/components/teams/team-page";
import { can } from "@/server/auth/actor";
import { requireAccount } from "@/server/auth/session";

export const metadata = { title: "Team" };

const paramsSchema = z.object({ teamId: z.uuid() });

/**
 * One team (WS-035). A path that is not a team id is a plain not-found page; a team the API
 * does not know is reported by the page itself, since it may have been deleted meanwhile.
 */
export default async function TeamRoute({ params }: { params: Promise<{ teamId: string }> }) {
  const { actor } = await requireAccount();
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    notFound();
  }

  return <TeamPage teamId={parsed.data.teamId} canManageTeams={can(actor, "teams:manage")} />;
}
