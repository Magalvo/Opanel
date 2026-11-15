"use client";

import { useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { Project } from "@/lib/schemas/projects";

import { archiveProject } from "./api";

export interface ArchiveSectionProps {
  project: Project;
  onProject: (project: Project) => void;
  onMessage: (message: string) => void;
}

/** Archive (after a confirmation) and unarchive (at once), WT-03 decision 4. */
export function ArchiveSection({ project, onProject, onMessage }: Readonly<ArchiveSectionProps>) {
  const [asking, setAsking] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const archived = project.archivedAt !== null;

  async function change(archive: boolean) {
    try {
      const next = await archiveProject(project.id, archive);
      onProject(next);
      onMessage(`${archive ? "Archived" : "Unarchived"} ${next.name}.`);
    } catch {
      onMessage(`Could not ${archive ? "archive" : "unarchive"} the project. Try again.`);
    }
  }

  return (
    <section aria-labelledby="archive-heading" className="grid gap-3">
      <h2 id="archive-heading" className="text-lg font-semibold">
        Archive
      </h2>
      {archived ? (
        <>
          <p className="text-sm text-muted-foreground">
            This project is archived, so it is read-only.
          </p>
          <div>
            <Button variant="outline" onClick={() => void change(false)}>
              Unarchive project
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            An archived project is hidden from the list and cannot be changed.
          </p>
          <div>
            <Button
              ref={opener}
              variant="outline"
              onClick={() => {
                setAsking(true);
              }}
            >
              Archive project
            </Button>
          </div>
        </>
      )}

      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            // The dialog is opened from code, so Radix has no trigger to give focus back to.
            event.preventDefault();
            opener.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this project?</AlertDialogTitle>
            <AlertDialogDescription>
              Archived projects are read-only. You can unarchive it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setAsking(false);
                void change(true);
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
