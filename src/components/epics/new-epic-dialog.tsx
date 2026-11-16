"use client";

import { useState } from "react";

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
import { ApiFailure } from "@/lib/api-client";
import type { CreateEpicRequest, Epic } from "@/lib/schemas/epics";

import { createEpic } from "./api";
import {
  checkEpic,
  type EpicDraft,
  type EpicErrors,
  epicErrorsFrom,
  EpicFields,
} from "./epic-fields";

const EMPTY: EpicDraft = { title: "", description: "", startDate: "", targetDate: "" };

/** "New epic" (WS-039 section 4): only the fields given are sent. */
export function NewEpicDialog({
  projectKey,
  onCreated,
  onFailure,
}: Readonly<{
  projectKey: string;
  onCreated: (epic: Epic) => void;
  onFailure: (failure: unknown, fallback: string) => void;
}>) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<EpicDraft>(EMPTY);
  const [errors, setErrors] = useState<EpicErrors>({});
  const [pending, setPending] = useState(false);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = checkEpic(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const body: CreateEpicRequest = { title: draft.title.trim() };
    if (draft.description !== "") body.description = draft.description;
    if (draft.startDate !== "") body.startDate = draft.startDate;
    if (draft.targetDate !== "") body.targetDate = draft.targetDate;
    setPending(true);
    try {
      const created = await createEpic(projectKey, body);
      setOpen(false);
      onCreated(created);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.errors.length > 0) {
        setErrors(epicErrorsFrom(failure.errors));
        return;
      }
      if (failure instanceof ApiFailure && failure.code === "project_archived") setOpen(false);
      onFailure(failure, "Could not create the epic. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft(EMPTY);
          setErrors({});
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>New epic</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New epic</DialogTitle>
          <DialogDescription>A large piece of work that groups tasks.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="grid gap-4" noValidate>
          <EpicFields draft={draft} errors={errors} onChange={setDraft} />
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
