import { Board } from "@/components/board/board";
import type { Project } from "@/lib/schemas/projects";

import { ProjectHeader } from "./project-header";

/** A project's page (WS-036, WS-037): the header and the board. */
export function ProjectView({
  project,
  canManage,
  canWrite,
}: Readonly<{ project: Project; canManage: boolean; canWrite: boolean }>) {
  return (
    <div className="grid gap-6">
      <ProjectHeader project={project} canManage={canManage} />
      <Board project={project} canWrite={canWrite} archived={project.archivedAt !== null} />
    </div>
  );
}
