"use client";

import { useState } from "react";

import { Markdown } from "@/components/markdown";
import { MarkdownEditor } from "@/components/markdown-editor";
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
import { Input } from "@/components/ui/input";
import { type Epic, epicSchema, epicTitleSchema } from "@/lib/schemas/epics";

import { ApiFailure, type EpicChanges, updateEpic } from "./api";
import { ProgressBar } from "./progress-bar";

const ORDER_ERROR = "The target date cannot be before the start date.";

function notDoneText(count: number): string {
  return `This epic still has ${String(count)} ${count === 1 ? "task that is" : "tasks that are"} not done. Close it anyway?`;
}

export interface EpicDialogProps {
  epic: Epic;
  /** The person may change epics and the project is writable. */
  writable: boolean;
  /** The epic as the server has it now, after a save or a conflict. */
  onChanged: (epic: Epic) => void;
  /** The epic was closed or reopened: the page says so and the dialog goes away. */
  onStatusChanged: (epic: Epic) => void;
  onArchived: () => void;
  onClose: () => void;
}

/** An epic: read-only for a reader, an edit form with Close and Reopen for a Manager (WS-039). */
export function EpicDialog({
  epic: initial,
  writable,
  onChanged,
  onStatusChanged,
  onArchived,
  onClose,
}: Readonly<EpicDialogProps>) {
  const [epic, setEpic] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [startDate, setStartDate] = useState(initial.startDate ?? "");
  const [targetDate, setTargetDate] = useState(initial.targetDate ?? "");
  const [errors, setErrors] = useState<Partial<Record<"title" | "targetDate", string>>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  function take(next: Epic) {
    setEpic(next);
    setTitle(next.title);
    setDescription(next.description);
    setStartDate(next.startDate ?? "");
    setTargetDate(next.targetDate ?? "");
    setErrors({});
    onChanged(next);
  }

  function failed(failure: unknown, fallback: string) {
    const current =
      failure instanceof ApiFailure && failure.code === "version_conflict"
        ? epicSchema.safeParse(failure.current)
        : null;
    if (current?.success) {
      take(current.data);
      setMessage(
        "Someone else changed this epic. Your edit was not saved; the current values are shown.",
      );
    } else if (failure instanceof ApiFailure && failure.code === "project_archived") {
      setMessage("The project is archived, so its epics are read-only.");
      onArchived();
    } else if (failure instanceof ApiFailure && failure.status === 400) {
      const next: Partial<Record<"title" | "targetDate", string>> = {};
      for (const error of failure.errors) {
        if (error.path === "title" || error.path === "targetDate") next[error.path] = error.message;
      }
      setErrors(next);
      if (Object.keys(next).length === 0) setMessage("Please check the details and try again.");
    } else {
      setMessage(fallback);
    }
  }

  const changes: Omit<EpicChanges, "version"> = {
    ...(title.trim() === epic.title ? {} : { title: title.trim() }),
    ...(description === epic.description ? {} : { description }),
    ...(startDate === (epic.startDate ?? "")
      ? {}
      : { startDate: startDate === "" ? null : startDate }),
    ...(targetDate === (epic.targetDate ?? "")
      ? {}
      : { targetDate: targetDate === "" ? null : targetDate }),
  };
  const changed = Object.keys(changes).length > 0;

  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Partial<Record<"title" | "targetDate", string>> = {};
    if (!epicTitleSchema.safeParse(title).success) next.title = "Enter a title.";
    if (startDate !== "" && targetDate !== "" && targetDate < startDate)
      next.targetDate = ORDER_ERROR;
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      take(await updateEpic(epic.id, { ...changes, version: epic.version }));
      setMessage("Saved the epic.");
    } catch (failure) {
      failed(failure, "Could not save the epic. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: "open" | "closed") {
    setAsking(false);
    setBusy(true);
    try {
      const updated = await updateEpic(epic.id, { status, version: epic.version });
      onStatusChanged(updated);
    } catch (failure) {
      failed(
        failure,
        status === "closed" ? "Could not close the epic." : "Could not reopen the epic.",
      );
    } finally {
      setBusy(false);
    }
  }

  const notDone = epic.progress.totalTasks - epic.progress.doneTasks;

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogTitle>{`Epic ${epic.title}`}</DialogTitle>
          <DialogDescription className="sr-only">
            The details of the epic and its progress.
          </DialogDescription>

          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={epic.status === "open" ? "secondary" : "outline"}>
              {epic.status === "open" ? "Open" : "Closed"}
            </Badge>
            <ProgressBar
              title={epic.title}
              doneTasks={epic.progress.doneTasks}
              totalTasks={epic.progress.totalTasks}
            />
          </div>

          <div
            role="status"
            aria-label="Epic dialog messages"
            className="min-h-5 text-sm text-muted-foreground"
          >
            {message}
          </div>

          {writable ? (
            <form onSubmit={(event) => void save(event)} className="grid gap-4" noValidate>
              <div className="grid gap-1.5">
                <label htmlFor="epic-title" className="text-sm font-medium">
                  Title
                </label>
                <Input
                  id="epic-title"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                  }}
                  aria-invalid={errors.title !== undefined}
                  autoComplete="off"
                />
                {errors.title !== undefined && (
                  <p className="text-sm text-destructive">{errors.title}</p>
                )}
              </div>
              <MarkdownEditor
                noun="description"
                label="Description"
                value={description}
                onChange={setDescription}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <label htmlFor="epic-start" className="text-sm font-medium">
                    Start date
                  </label>
                  <Input
                    id="epic-start"
                    type="date"
                    value={startDate}
                    onChange={(event) => {
                      setStartDate(event.target.value);
                    }}
                  />
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor="epic-target" className="text-sm font-medium">
                    Target date
                  </label>
                  <Input
                    id="epic-target"
                    type="date"
                    value={targetDate}
                    onChange={(event) => {
                      setTargetDate(event.target.value);
                    }}
                    aria-invalid={errors.targetDate !== undefined}
                  />
                  {errors.targetDate !== undefined && (
                    <p className="text-sm text-destructive">{errors.targetDate}</p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy || !changed}>
                  Save changes
                </Button>
                {epic.status === "open" ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      if (notDone > 0) setAsking(true);
                      else void setStatus("closed");
                    }}
                  >
                    Close epic
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void setStatus("open")}
                  >
                    Reopen epic
                  </Button>
                )}
              </div>
            </form>
          ) : (
            <div className="grid gap-3">
              <dl className="grid gap-1 text-sm sm:grid-cols-[6rem_1fr]">
                <dt className="text-muted-foreground">Start</dt>
                <dd className="tabular-nums">{epic.startDate ?? "—"}</dd>
                <dt className="text-muted-foreground">Target</dt>
                <dd className="tabular-nums">{epic.targetDate ?? "—"}</dd>
              </dl>
              {epic.description.trim() === "" ? (
                <p className="text-sm text-muted-foreground">No description.</p>
              ) : (
                <Markdown>{epic.description}</Markdown>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close this epic?</AlertDialogTitle>
            <AlertDialogDescription>{notDoneText(notDone)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void setStatus("closed")}>
              Close epic
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
