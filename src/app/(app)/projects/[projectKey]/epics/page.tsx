import { EpicsPage } from "@/components/epics/epics-page";
import { can } from "@/server/auth/actor";
import { requireAccount } from "@/server/auth/session";

import { loadProject } from "../../load-project";

export const metadata = { title: "Epics" };

/**
 * A project's epics (WS-039). Everyone signed in reads them; only a Manager or Admin gets the
 * controls, and the API enforces `epics:manage` on every write.
 */
export default async function EpicsRoute({
  params,
}: Readonly<{ params: Promise<{ projectKey: string }> }>) {
  const { actor } = await requireAccount();
  const { projectKey } = await params;
  const project = await loadProject(actor, projectKey);

  return (
    <EpicsPage
      project={project}
      canManage={can(actor, "epics:manage")}
      archived={project.archivedAt !== null}
    />
  );
}
