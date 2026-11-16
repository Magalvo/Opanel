"use client";

import { type ReactNode, useId, useState } from "react";

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
import { ApiFailure } from "@/lib/api-client";
import { createTeamRequestSchema } from "@/lib/schemas/teams";

/**
 * A button that opens a dialog asking for a team's name, used to create and to rename a
 * team. `onSubmit` sends the name; an `ApiFailure` it throws is shown in the dialog.
 */
export function TeamNameDialog({
  trigger,
  title,
  description,
  submitLabel,
  initialName = "",
  onSubmit,
}: Readonly<{
  trigger: ReactNode;
  title: string;
  description: string;
  submitLabel: string;
  initialName?: string;
  onSubmit: (name: string) => Promise<void>;
}>) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = createTeamRequestSchema.safeParse({ name });
    if (!parsed.success) {
      setError(name.trim() === "" ? "Enter a name." : "Use at most 100 characters.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      await onSubmit(parsed.data.name);
      setOpen(false);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "team_name_taken") {
        setError("Another team has this name.");
      } else if (failure instanceof ApiFailure && failure.status === 400) {
        setError(failure.errors.find((fieldError) => fieldError.path === "name")?.message ?? null);
        setFormError("Please check the name and try again.");
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
        if (next) {
          setName(initialName);
          setError(null);
          setFormError(null);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <label htmlFor={fieldId} className="text-sm font-medium">
              Name
            </label>
            <Input
              id={fieldId}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              aria-invalid={error === null ? undefined : true}
              aria-describedby={error === null ? undefined : `${fieldId}-error`}
              autoComplete="off"
            />
            {error !== null && (
              <p id={`${fieldId}-error`} className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          {formError !== null && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
