import { SettingsIcon } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { Project } from "@/lib/schemas/projects";

/**
 * A project's name, key and description (WS-036). The description is stored as Markdown and
 * shown here as plain text until `react-markdown` arrives with WI-038. The board of WI-037
 * is drawn under it by `ProjectView`.
 */
export function ProjectHeader({
  project,
  canManage,
}: Readonly<{ project: Project; canManage: boolean }>) {
  return (
    <div className="grid max-w-5xl gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs">{project.key}</span>
          {project.archivedAt !== null && <Badge variant="outline">Archived</Badge>}
        </div>
        {canManage && (
          <Link
            href={`/projects/${project.key}/settings`}
            className="inline-flex items-center gap-1.5 text-sm underline-offset-4 hover:underline"
          >
            <SettingsIcon aria-hidden="true" className="size-4" />
            Settings
          </Link>
        )}
      </div>
      {project.description !== "" && (
        <p className="text-sm whitespace-pre-wrap text-muted-foreground">{project.description}</p>
      )}
    </div>
  );
}
