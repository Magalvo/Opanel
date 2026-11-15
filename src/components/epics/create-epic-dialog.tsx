"use client";

import { useState } from "react";

import { MarkdownEditor } from "@/components/markdown-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { type Epic, epicTitleSchema } from "@/lib/schemas/epics";

import { ApiFailure, createEpic, type NewEpic } from "./api";

type Field = "title" | "description" | "startDate" | "targetDate";

const ORDER_ERROR = "The target date cannot be before the start date.";

/** The "New epic" button and the dialog it opens (WS-039). */
export function CreateEpicDialog({
  projectId,
  onCreated,
  onArchived,
}: Readonly<{
  projectId: string;
  onCreated: (epic: Epic) => void;
  onArchived: () => void;
}>) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setTitle("");
    setDescription("");
    setStartDate("");
    setTargetDate("");
    setErrors({});
    setFormError(null);
  }

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const next: Partial<Record<Field, string>> = {};
    const parsedTitle = epicTitleSchema.safeParse(title);
    if (!parsedTitle.success) next.title = "Enter a title.";
    if (startDate !== "" && targetDate !== "" && targetDate < startDate) {
      next.targetDate = ORDER_ERROR;
    }
    setErrors(next);
    if (!parsedTitle.success || next.targetDate !== undefined) return;

    const body: NewEpic = {
      title: parsedTitle.data,
      ...(description === "" ? {} : { description }),
      ...(startDate === "" ? {} : { startDate }),
      ...(targetDate === "" ? {} : { targetDate }),
    };
    setPending(true);
    try {
      const created = await createEpic(projectId, body);
      setOpen(false);
      reset();
      onCreated(created);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "project_archived") {
        setOpen(false);
        reset();
        onArchived();
      } else if (failure instanceof ApiFailure && failure.status === 400) {
        const fromApi: Partial<Record<Field, string>> = {};
        for (const error of failure.errors) {
          if (
            error.path === "title" ||
            error.path === "description" ||
            error.path === "startDate" ||
            error.path === "targetDate"
          ) {
            fromApi[error.path] = error.message;
          }
        }
        setErrors(fromApi);
        if (Object.keys(fromApi).length === 0)
          setFormError("Please check the details and try again.");
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>New epic</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New epic</DialogTitle>
          <DialogDescription>An epic groups tasks of this project.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <label htmlFor="new-epic-title" className="text-sm font-medium">
              Title
            </label>
            <Input
              id="new-epic-title"
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
          <div className="grid gap-1.5">
            <MarkdownEditor
              noun="description"
              label="Description"
              value={description}
              onChange={setDescription}
            />
            {errors.description !== undefined && (
              <p className="text-sm text-destructive">{errors.description}</p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label htmlFor="new-epic-start" className="text-sm font-medium">
                Start date
              </label>
              <Input
                id="new-epic-start"
                type="date"
                value={startDate}
                onChange={(event) => {
                  setStartDate(event.target.value);
                }}
              />
              {errors.startDate !== undefined && (
                <p className="text-sm text-destructive">{errors.startDate}</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="new-epic-target" className="text-sm font-medium">
                Target date
              </label>
              <Input
                id="new-epic-target"
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
          {formError !== null && <p className="text-sm text-destructive">{formError}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Create epic
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
