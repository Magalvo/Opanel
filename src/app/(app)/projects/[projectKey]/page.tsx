import { ProjectHeader } from "@/components/projects/project-header";
import { can } from "@/server/auth/actor";
import { requireAccount } from "@/server/auth/session";

import { loadProject } from "../load-project";

export const metadata = { title: "Project" };

/** A project's page (WS-036): its header now, its board with WI-037. */
export default async function ProjectRoute({
  params,
}: Readonly<{ params: Promise<{ projectKey: string }> }>) {
  const { actor } = await requireAccount();
  const { projectKey } = await params;
  const project = await loadProject(actor, projectKey);

  return <ProjectHeader project={project} canManage={can(actor, "projects:manage")} />;
}
