import { notFound } from "next/navigation";

import { ProjectSettings } from "@/components/projects/project-settings";
import { can } from "@/server/auth/actor";
import { requireAccount } from "@/server/auth/session";

export const metadata = { title: "Project settings" };

/**
 * A project's settings (WS-036), for Managers and Admins. Anyone else gets a plain
 * not-found page. The layout has already checked the project key.
 */
export default async function SettingsRoute() {
  const { actor } = await requireAccount();
  if (!can(actor, "projects:manage")) {
    notFound();
  }

  return <ProjectSettings canRestoreTasks={can(actor, "tasks:delete_any")} />;
}
