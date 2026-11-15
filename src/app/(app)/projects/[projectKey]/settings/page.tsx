import { notFound } from "next/navigation";

import { ProjectSettings } from "@/components/projects/project-settings";
import { can } from "@/server/auth/actor";
import { requireAccount } from "@/server/auth/session";

import { loadProject } from "../../load-project";

export const metadata = { title: "Project settings" };

/**
 * A project's settings (WS-036). For anyone without `projects:manage` it is a plain
 * not-found page, so it does not confirm that it exists; the API stays the guard.
 */
export default async function ProjectSettingsRoute({
  params,
}: Readonly<{ params: Promise<{ projectKey: string }> }>) {
  const { actor } = await requireAccount();
  if (!can(actor, "projects:manage")) {
    notFound();
  }
  const { projectKey } = await params;

  return <ProjectSettings project={await loadProject(actor, projectKey)} />;
}
