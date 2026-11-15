import { ProjectView } from "@/components/projects/project-view";
import { can } from "@/server/auth/actor";
import { requireAccount } from "@/server/auth/session";

import { loadProject } from "../load-project";

export const metadata = { title: "Project" };

/** A project's page (WS-036, WS-037): its header and its board. */
export default async function ProjectRoute({
  params,
}: Readonly<{ params: Promise<{ projectKey: string }> }>) {
  const { actor } = await requireAccount();
  const { projectKey } = await params;
  const project = await loadProject(actor, projectKey);

  return (
    <ProjectView
      project={project}
      canManage={can(actor, "projects:manage")}
      canWrite={can(actor, "tasks:write")}
    />
  );
}
