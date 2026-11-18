"use client";

import { useId, useState } from "react";

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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiFailure } from "@/lib/api-client";
import { projectNameSchema, projectSchema } from "@/lib/schemas/projects";

import { setArchived, updateProject } from "./api";
import { useProjectEventListener } from "./project-events";
import { useProject } from "./project-frame";

const CONFLICT =
  "Someone else changed this project. Their version is shown; make your change again.";
const CHANGED_WHILE_EDITING =
  "Someone else changed this project. Saving will show their version first.";

/** Name and description, archive and unarchive (WS-036 section 5). */
export function DetailsSection({ announce }: Readonly<{ announce: (message: string) => void }>) {
  const id = useId();
  const { project, setProject } = useProject();
  const archived = project.archivedAt !== null;
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [version, setVersion] = useState(project.version);
  const [nameError, setNameError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  // Live (WS-049 section 5): the frame sets a project someone else changed. The form takes
  // it unless it has unsaved edits; then it keeps them and its version, so the next save
  // gets the conflict and shows their version first.
  const [basedOn, setBasedOn] = useState(project);
  const [keepEdits, setKeepEdits] = useState(false);
  const dirty = name !== basedOn.name || description !== basedOn.description;
  useProjectEventListener({
    onEvent: (event) => {
      if (event.type !== "project.changed" || event.version <= version || !dirty) return;
      setKeepEdits(true);
      announce(CHANGED_WHILE_EDITING);
    },
  });
  if (basedOn !== project) {
    setBasedOn(project);
    if (keepEdits && project.version > version) {
      setKeepEdits(false);
    } else if (project.version > version) {
      setName(project.name);
      setDescription(project.description);
      setVersion(project.version);
    }
  }

  function show(current: typeof project) {
    setProject(current);
    setName(current.name);
    setDescription(current.description);
    setVersion(current.version);
  }

  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectNameSchema.safeParse(name).success) {
      setNameError(name.trim() === "" ? "Enter a name." : "Use at most 100 characters.");
      return;
    }
    setNameError(null);
    setPending(true);
    try {
      show(await updateProject(project.key, { name, description, version }));
      announce("Saved.");
    } catch (failure) {
      const current =
        failure instanceof ApiFailure && failure.code === "version_conflict"
          ? projectSchema.safeParse((failure.body as { current?: unknown } | null)?.current)
          : null;
      if (current?.success) {
        show(current.data);
        announce(CONFLICT);
      } else if (failure instanceof ApiFailure && failure.code === "project_archived") {
        announce("The project is archived.");
      } else {
        announce("Could not save. Try again.");
      }
    } finally {
      setPending(false);
    }
  }

  async function archive(to: boolean) {
    try {
      show(await setArchived(project.key, to));
      announce(`${project.key} was ${to ? "archived" : "unarchived"}.`);
    } catch {
      announce(`Could not ${to ? "archive" : "unarchive"} the project. Try again.`);
    }
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="grid gap-4">
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        Details
      </h2>
      <form onSubmit={(event) => void save(event)} className="grid gap-4" noValidate>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-name`} className="text-sm font-medium">
            Name
          </label>
          <Input
            id={`${id}-name`}
            value={name}
            disabled={archived}
            onChange={(event) => {
              setName(event.target.value);
            }}
            aria-invalid={nameError === null ? undefined : true}
            aria-describedby={nameError === null ? undefined : `${id}-name-error`}
            autoComplete="off"
          />
          {nameError !== null && (
            <p id={`${id}-name-error`} className="text-sm text-destructive">
              {nameError}
            </p>
          )}
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-description`} className="text-sm font-medium">
            Description
          </label>
          <Textarea
            id={`${id}-description`}
            value={description}
            disabled={archived}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
            aria-describedby={`${id}-description-hint`}
          />
          <p id={`${id}-description-hint`} className="text-xs text-muted-foreground">
            Markdown.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={archived || pending}>
            Save
          </Button>
          {archived ? (
            <Button type="button" variant="outline" onClick={() => void archive(false)}>
              Unarchive project
            </Button>
          ) : (
            // Outline, not destructive: the destructive style lacks contrast (WS-035).
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirmingArchive(true);
              }}
            >
              Archive project
            </Button>
          )}
        </div>
      </form>
      <AlertDialog open={confirmingArchive} onOpenChange={setConfirmingArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {project.key}?</AlertDialogTitle>
            <AlertDialogDescription>
              Everything in it becomes read-only until it is unarchived.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmingArchive(false);
                void archive(true);
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
