"use client";

import { PencilIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";

import {
  COLOUR_NAMES,
  createLabel,
  deleteLabel,
  listLabels,
  updateLabel,
} from "@/components/labels/api";
import { LabelChip } from "@/components/labels/label-chip";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiFailure } from "@/lib/api-client";
import { type Label, LABEL_COLOURS, type LabelColour, labelNameSchema } from "@/lib/schemas/labels";

import { useProjectEventListener } from "./project-events";
import { useProject } from "./project-frame";

const MESSAGES: Record<string, string> = {
  label_name_taken: "Another label has this name.",
  too_many_labels: "This project already has 200 labels.",
  project_archived: "The project is archived.",
};

const CONFLICT = "Someone else changed this label. The list was refreshed.";

function explain(failure: unknown, fallback: string): string {
  if (!(failure instanceof ApiFailure) || failure.code === null) return fallback;
  return MESSAGES[failure.code] ?? fallback;
}

interface LabelDraft {
  name: string;
  colour: LabelColour;
}

/**
 * A project's labels (WS-108 section 5): add, rename, recolour and delete. The settings
 * page is for Managers and Admins, who all hold `labels:manage`.
 */
export function LabelsSection({
  announce,
  readOnly,
}: Readonly<{ announce: (message: string) => void; readOnly: boolean }>) {
  const id = useId();
  const { project } = useProject();
  const projectKey = project.key;
  const [labels, setLabels] = useState<Label[] | null>(null);
  const [failedToLoad, setFailedToLoad] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Label | null>(null);
  const [deleting, setDeleting] = useState<Label | null>(null);

  const reload = useCallback(async () => {
    try {
      setLabels((await listLabels(projectKey)).items);
      setFailedToLoad(false);
    } catch {
      setFailedToLoad(true);
    }
  }, [projectKey]);

  useEffect(() => {
    let cancelled = false;
    listLabels(projectKey).then(
      (loaded) => {
        if (!cancelled) setLabels(loaded.items);
      },
      () => {
        if (!cancelled) setFailedToLoad(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectKey]);

  useProjectEventListener({
    onEvent: (event) => {
      if (event.type === "label.changed") void reload();
    },
    onReconnect: () => void reload(),
  });

  /**
   * Runs an addition or an edit. A refusal the person can fix stays in the dialog; a
   * version conflict closes it, says so and reads the list again.
   */
  async function save(run: () => Promise<Label>, success: (label: Label) => string) {
    try {
      const label = await run();
      announce(success(label));
      await reload();
      return null;
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "version_conflict") {
        announce(CONFLICT);
        await reload();
        return null;
      }
      return explain(failure, "Could not save the label. Try again.");
    }
  }

  async function remove(label: Label) {
    try {
      await deleteLabel(label.id);
      announce(`Deleted label ${label.name}.`);
    } catch (failure) {
      announce(explain(failure, "Could not delete the label. Try again."));
    }
    await reload();
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-heading`} className="text-lg font-semibold">
          Labels
        </h2>
        {!readOnly && (
          <Button
            variant="outline"
            disabled={labels === null}
            onClick={() => {
              setAdding(true);
            }}
          >
            Add label
          </Button>
        )}
      </div>

      {failedToLoad && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            Could not load the labels.
          </p>
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      )}
      {labels === null && !failedToLoad && (
        <p className="text-sm text-muted-foreground">Loading labels…</p>
      )}
      {labels?.length === 0 && <p className="text-sm text-muted-foreground">No labels yet.</p>}

      {labels !== null && labels.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Colour</TableHead>
              {!readOnly && <TableHead className="w-24 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {labels.map((label) => (
              <TableRow key={label.id}>
                <TableCell className="max-w-0">
                  <LabelChip label={label} />
                </TableCell>
                <TableCell>{COLOUR_NAMES[label.colour]}</TableCell>
                {!readOnly && (
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${label.name}`}
                        onClick={() => {
                          setEditing(label);
                        }}
                      >
                        <PencilIcon aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${label.name}`}
                        onClick={() => {
                          setDeleting(label);
                        }}
                      >
                        <Trash2Icon aria-hidden="true" />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {adding && (
        <LabelDialog
          onClose={() => {
            setAdding(false);
          }}
          title="Add a label"
          submitLabel="Add label"
          initial={{ name: "", colour: "gray" }}
          onSubmit={(draft) =>
            save(
              () => createLabel(projectKey, draft),
              (label) => `Added label ${label.name}.`,
            )
          }
        />
      )}

      {editing !== null && (
        <LabelDialog
          onClose={() => {
            setEditing(null);
          }}
          title="Edit label"
          submitLabel="Save"
          initial={{ name: editing.name, colour: editing.colour }}
          onSubmit={(draft) =>
            save(
              () =>
                updateLabel(editing.id, {
                  ...(draft.name === editing.name ? {} : { name: draft.name }),
                  ...(draft.colour === editing.colour ? {} : { colour: draft.colour }),
                  version: editing.version,
                }),
              (label) => `Saved label ${label.name}.`,
            )
          }
        />
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        {deleting !== null && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete label {deleting.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                It is removed from every task that has it. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  const label = deleting;
                  setDeleting(null);
                  void remove(label);
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </section>
  );
}

/**
 * A label's name and colour, to add or to edit one. `onSubmit` answers `null` when done,
 * which closes the dialog, or a message to show in it.
 */
function LabelDialog({
  onClose,
  title,
  submitLabel,
  initial,
  onSubmit,
}: Readonly<{
  onClose: () => void;
  title: string;
  submitLabel: string;
  initial: LabelDraft;
  onSubmit: (draft: LabelDraft) => Promise<string | null>;
}>) {
  const id = useId();
  const [name, setName] = useState(initial.name);
  const [colour, setColour] = useState<LabelColour>(initial.colour);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const unchanged = name.trim() === initial.name && colour === initial.colour;

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = labelNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(name.trim() === "" ? "Enter a name." : "Use at most 40 characters.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const refused = await onSubmit({ name: parsed.data, colour });
      if (refused === null) onClose();
      else setError(refused);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Everyone who can apply labels sees it on tasks.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-name`} className="text-sm font-medium">
              Name
            </label>
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={60}
              onChange={(event) => {
                setName(event.target.value);
              }}
              aria-invalid={error === null ? undefined : true}
              aria-describedby={error === null ? undefined : `${id}-name-error`}
              autoComplete="off"
            />
            {error !== null && (
              <p id={`${id}-name-error`} className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Colour</legend>
            <div className="flex flex-wrap gap-2">
              {LABEL_COLOURS.map((option) => (
                <label key={option} className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name={`${id}-colour`}
                    value={option}
                    checked={colour === option}
                    aria-label={COLOUR_NAMES[option]}
                    onChange={() => {
                      setColour(option);
                    }}
                    className="size-4"
                  />
                  <LabelChip label={{ name: COLOUR_NAMES[option], colour: option }} />
                </label>
              ))}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="submit" disabled={pending || unchanged}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
