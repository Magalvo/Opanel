"use client";

import { useId, useState } from "react";

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
import { ApiFailure } from "@/lib/api-client";
import type { Column } from "@/lib/schemas/columns";
import { type Task, taskTitleSchema, type TaskType, taskTypeSchema } from "@/lib/schemas/tasks";

import { createTask } from "./api";
import { TYPE_LABELS } from "./task-card";

/**
 * Adds a task to a column, or to the backlog when `column` is null (WS-109 section 4), with
 * a title and a type (WS-037 section 4). Closes on success and when the project turns out
 * to be archived; other problems are shown in the dialog.
 */
export function NewTaskDialog({
  projectKey,
  column,
  returnFocusTo,
  onOpenChange,
  onCreated,
  onArchived,
}: Readonly<{
  projectKey: string;
  /** The column the task goes to the end of; `null` for the end of the backlog. */
  column: Column | null;
  /** Without a dialog trigger, the element that gets the focus back on close. */
  returnFocusTo: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
  onCreated: (task: Task) => void;
  onArchived: () => void;
}>) {
  const id = useId();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskType>("task");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = taskTitleSchema.safeParse(title);
    if (!parsed.success) {
      setTitleError(title.trim() === "" ? "Enter a title." : "Use at most 200 characters.");
      return;
    }
    setTitleError(null);
    setError(null);
    setPending(true);
    try {
      const task = await createTask(projectKey, {
        title: parsed.data,
        type,
        columnId: column === null ? null : column.id,
      });
      onCreated(task);
      onOpenChange(false);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "project_archived") {
        onOpenChange(false);
        onArchived();
        return;
      }
      const atTitle =
        failure instanceof ApiFailure
          ? failure.errors.find((item) => item.path === "title")
          : undefined;
      if (atTitle === undefined) {
        setError("Could not add the task. Try again.");
      } else {
        setTitleError(atTitle.message);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusTo?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {column === null ? "Add a task to the backlog" : `Add a task to ${column.name}`}
          </DialogTitle>
          <DialogDescription>
            {column === null
              ? "It goes to the end of the backlog."
              : "It goes to the end of the column."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-title`} className="text-sm font-medium">
              Title
            </label>
            <Input
              id={`${id}-title`}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              aria-invalid={titleError === null ? undefined : true}
              aria-describedby={titleError === null ? undefined : `${id}-title-error`}
              autoComplete="off"
            />
            {titleError !== null && (
              <p id={`${id}-title-error`} className="text-sm text-destructive">
                {titleError}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-type`} className="text-sm font-medium">
              Type
            </label>
            <select
              id={`${id}-type`}
              value={type}
              onChange={(event) => {
                setType(taskTypeSchema.parse(event.target.value));
              }}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
            >
              {taskTypeSchema.options.map((option) => (
                <option key={option} value={option}>
                  {TYPE_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Add task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
