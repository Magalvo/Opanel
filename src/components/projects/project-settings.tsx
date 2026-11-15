"use client";

import { useState } from "react";

import type { Project } from "@/lib/schemas/projects";

import { ArchiveSection } from "./archive-section";
import { ColumnsSection } from "./columns-section";
import { DeletedTasksSection } from "./deleted-tasks-section";
import { DetailsSection } from "./details-section";

/** The settings of a project (WS-036), for a Manager or Admin. */
export function ProjectSettings({ project: initial }: Readonly<{ project: Project }>) {
  const [project, setProject] = useState(initial);
  const [message, setMessage] = useState("");
  const archived = project.archivedAt !== null;

  return (
    <div className="grid max-w-5xl gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{`${project.name} settings`}</h1>

      <div role="status" className="min-h-5 text-sm text-muted-foreground">
        {message}
      </div>

      <DetailsSection
        // A saved or reloaded project starts the form again from its values.
        key={String(project.version)}
        project={project}
        archived={archived}
        onProject={setProject}
        onMessage={setMessage}
      />
      <ArchiveSection project={project} onProject={setProject} onMessage={setMessage} />
      <ColumnsSection projectId={project.id} archived={archived} onMessage={setMessage} />
      <DeletedTasksSection projectId={project.id} archived={archived} onMessage={setMessage} />
    </div>
  );
}
