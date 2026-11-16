import { ProjectsPage, type ProjectsView } from "@/components/projects/projects-page";
import { can } from "@/server/auth/actor";
import { requireAccount } from "@/server/auth/session";

export const metadata = { title: "Projects" };

/**
 * The projects list (WS-036). Every signed-in person reads it; Managers and Admins also
 * create projects. `?view=archived` shows archived projects instead of active ones.
 */
export default async function ProjectsRoute({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const { actor } = await requireAccount();
  const view: ProjectsView = (await searchParams).view === "archived" ? "archived" : "active";

  // A new key per view, so switching views starts from a fresh list.
  return <ProjectsPage key={view} view={view} canManageProjects={can(actor, "projects:manage")} />;
}
