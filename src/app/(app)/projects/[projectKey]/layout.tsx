import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { ProjectFrame } from "@/components/projects/project-frame";
import { projectKeySchema } from "@/lib/schemas/projects";
import { can } from "@/server/auth/actor";
import { requireAccount } from "@/server/auth/session";

/**
 * Every page of a project (WS-036): its header and navigation. A segment that is not a
 * project key is a plain not-found page; a key the API does not know is reported by the
 * frame, since the project may be gone.
 */
export default async function ProjectLayout({
  children,
  modal,
  params,
}: {
  children: ReactNode;
  /** A task opened from the board, as a dialog over it (WS-038). */
  modal: ReactNode;
  params: Promise<{ projectKey: string }>;
}) {
  const { actor } = await requireAccount();
  const parsed = projectKeySchema.safeParse((await params).projectKey);
  if (!parsed.success) {
    notFound();
  }

  return (
    <ProjectFrame
      projectKey={parsed.data}
      canManageProjects={can(actor, "projects:manage")}
      modal={modal}
    >
      {children}
    </ProjectFrame>
  );
}
