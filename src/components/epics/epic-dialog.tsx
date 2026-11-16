"use client";

import { useRef, useState } from "react";

import { Markdown } from "@/components/markdown";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ApiFailure } from "@/lib/api-client";
import { type Epic, epicSchema, type UpdateEpicRequest } from "@/lib/schemas/epics";

import { updateEpic } from "./api";
import {
  checkEpic,
  type EpicDraft,
  type EpicErrors,
  epicErrorsFrom,
  EpicFields,
} from "./epic-fields";
import { EpicProgress } from "./epic-progress";

const CONFLICT = "Someone else changed this epic. Their version is shown; make your change again.";

function draftOf(epic: Epic): EpicDraft {
  return {
    title: epic.title,
    description: epic.description,
    startDate: epic.startDate ?? "",
    targetDate: epic.targetDate ?? "",
  };
}

/** Only what changed, as the update request expects it; a cleared date is `null`. */
function changesOf(epic: Epic, draft: EpicDraft): Omit<UpdateEpicRequest, "version"> {
  const changes: Omit<UpdateEpicRequest, "version"> = {};
  if (draft.title !== epic.title) changes.title = draft.title;
  if (draft.description !== epic.description) changes.description = draft.description;
  if (draft.startDate !== (epic.startDate ?? "")) {
    changes.startDate = draft.startDate === "" ? null : draft.startDate;
  }
  if (draft.targetDate !== (epic.targetDate ?? "")) {
    changes.targetDate = draft.targetDate === "" ? null : draft.targetDate;
  }
  return changes;
}

function currentOf(failure: ApiFailure): Epic | null {
  if (typeof failure.body !== "object" || failure.body === null) return null;
  const parsed = epicSchema.safeParse((failure.body as { current?: unknown }).current);
  return parsed.success ? parsed.data : null;
}

function dateText(date: string | null): string {
  return date ?? "—";
}

/**
 * One epic (WS-039 section 3): read by everyone, edited, closed and reopened by those who
 * may manage epics while the project is writable. Every answer of the API is handed to the
 * page with `onChanged`, which updates the list too.
 */
export function EpicDialog({
  epic,
  writable,
  returnFocusTo,
  message,
  onClose,
  onChanged,
  onFailure,
}: Readonly<{
  epic: Epic;
  writable: boolean;
  returnFocusTo: HTMLElement | null;
  /** The page's latest message: the page itself is hidden while this dialog is open. */
  message: string;
  onClose: () => void;
  onChanged: (epic: Epic, message: string) => void;
  onFailure: (failure: unknown, fallback: string) => void;
}>) {
  const [draft, setDraft] = useState<EpicDraft>(() => draftOf(epic));
  const [errors, setErrors] = useState<EpicErrors>({});
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const statusButton = useRef<HTMLButtonElement>(null);

  // A new version of the epic: after a conflict the form starts again from it; otherwise
  // edits not saved yet are kept and every other field takes the new value (as WS-038).
  const [basedOn, setBasedOn] = useState({ epic, conflicts });
  if (basedOn.epic !== epic || basedOn.conflicts !== conflicts) {
    const fresh = draftOf(epic);
    if (basedOn.conflicts === conflicts) {
      const before = draftOf(basedOn.epic);
      for (const key of Object.keys(fresh) as (keyof EpicDraft)[]) {
        if (draft[key] !== before[key]) fresh[key] = draft[key];
      }
    }
    setBasedOn({ epic, conflicts });
    setDraft(fresh);
  }

  const changes = changesOf(epic, draft);
  const changed = Object.keys(changes).length > 0;
  const notDone = epic.progress.totalTasks - epic.progress.doneTasks;

  async function write(body: UpdateEpicRequest, message: (epic: Epic) => string) {
    setBusy(true);
    try {
      const updated = await updateEpic(epic.id, body);
      setErrors({});
      onChanged(updated, message(updated));
    } catch (failure) {
      const current =
        failure instanceof ApiFailure && failure.code === "version_conflict"
          ? currentOf(failure)
          : null;
      if (current !== null) {
        setConflicts((count) => count + 1);
        onChanged(current, CONFLICT);
        return;
      }
      if (failure instanceof ApiFailure && failure.errors.length > 0) {
        setErrors(epicErrorsFrom(failure.errors));
      }
      onFailure(failure, "Could not save the epic. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = checkEpic(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    void write({ ...changes, version: epic.version }, () => "Saved.");
  }

  function setStatus(status: Epic["status"]) {
    void write({ status, version: epic.version }, (updated) =>
      status === "closed" ? `${updated.title} was closed.` : `${updated.title} was reopened.`,
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusTo?.focus();
        }}
      >
        <div className="grid min-w-0 gap-1 pr-8">
          <DialogTitle className="break-words">{epic.title}</DialogTitle>
          <DialogDescription className="sr-only">An epic and its progress.</DialogDescription>
        </div>
        <p role="status" aria-label="Epic messages" className="min-h-5 text-sm">
          {message}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <Badge variant={epic.status === "open" ? "secondary" : "outline"}>
              {epic.status === "open" ? "Open" : "Closed"}
            </Badge>
          </dd>
          <dt className="text-muted-foreground">Progress</dt>
          <dd>
            <EpicProgress progress={epic.progress} />
          </dd>
          {!writable && (
            <>
              <dt className="text-muted-foreground">Start</dt>
              <dd>{dateText(epic.startDate)}</dd>
              <dt className="text-muted-foreground">Target</dt>
              <dd>{dateText(epic.targetDate)}</dd>
            </>
          )}
        </dl>

        {writable ? (
          <form onSubmit={save} className="grid min-w-0 gap-4" noValidate>
            <EpicFields draft={draft} errors={errors} onChange={setDraft} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!changed || busy}>
                Save changes
              </Button>
              <Button
                ref={statusButton}
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (epic.status === "closed") setStatus("open");
                  else if (notDone > 0) setConfirming(true);
                  else setStatus("closed");
                }}
              >
                {epic.status === "closed" ? "Reopen epic" : "Close epic"}
              </Button>
            </div>
          </form>
        ) : epic.description.trim() === "" ? (
          <p className="text-sm text-muted-foreground">No description.</p>
        ) : (
          <Markdown>{epic.description}</Markdown>
        )}

        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              statusButton.current?.focus();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Close {epic.title}?</AlertDialogTitle>
              <AlertDialogDescription>
                {notDone} of its tasks are not done yet.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setStatus("closed");
                }}
              >
                Close epic
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
