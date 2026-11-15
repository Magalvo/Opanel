import { ProjectsPage } from "@/components/projects/projects-page";
import { can } from "@/server/auth/actor";
import { requireAccount } from "@/server/auth/session";

export const metadata = { title: "Projects" };

/**
 * The projects list (WS-036). Everyone signed in reads it; only a Manager or Admin gets
 * "New project". The API enforces `projects:manage` on creating, so this decides only what
 * the page shows.
 */
export default async function ProjectsRoute() {
  const { actor } = await requireAccount();

  return <ProjectsPage canManage={can(actor, "projects:manage")} />;
}
