"use client";

import { useState } from "react";

import { ColumnsSection } from "./columns-section";
import { DeletedTasksSection } from "./deleted-tasks-section";
import { DetailsSection } from "./details-section";
import { LabelsSection } from "./labels-section";
import { useProject } from "./project-frame";
import { SprintsSection } from "./sprints-section";
import { TriageSection } from "./triage-section";

/**
 * A project's settings (WS-036): details, columns, sprints (WS-144), labels (WS-108), triage
 * (WS-092) and deleted tasks, for managers.
 */
export function ProjectSettings({
  canRestoreTasks,
  canManageTriage,
  canManageSprints = false,
}: Readonly<{ canRestoreTasks: boolean; canManageTriage: boolean; canManageSprints?: boolean }>) {
  const { project } = useProject();
  const [message, setMessage] = useState("");
  const archived = project.archivedAt !== null;

  return (
    <div className="grid max-w-3xl gap-8">
      <div role="status" className="min-h-5 text-sm text-muted-foreground">
        {message}
      </div>
      {archived && <p className="text-sm">This project is archived, so it is read-only.</p>}
      <DetailsSection announce={setMessage} />
      <ColumnsSection announce={setMessage} readOnly={archived} />
      <SprintsSection announce={setMessage} readOnly={archived || !canManageSprints} />
      <LabelsSection announce={setMessage} readOnly={archived} />
      <TriageSection announce={setMessage} readOnly={archived || !canManageTriage} />
      {canRestoreTasks && <DeletedTasksSection announce={setMessage} readOnly={archived} />}
    </div>
  );
}
