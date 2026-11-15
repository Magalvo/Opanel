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
import { Input } from "@/components/ui/input";
import { createTeamRequestSchema, type Team } from "@/lib/schemas/teams";

import { ApiFailure, createTeam } from "./api";

/** The "New team" button and the dialog it opens. */
export function CreateTeamDialog({ onCreated }: Readonly<{ onCreated: (team: Team) => void }>) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reset() {
    setName("");
    setError(null);
  }

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createTeamRequestSchema.safeParse({ name });
    if (!parsed.success) {
      setError(name.trim().length > 100 ? "Use at most 100 characters." : "A name is required.");
      return;
    }
    setError(null);
    setPending(true);

    try {
      const team = await createTeam(parsed.data.name);
      setOpen(false);
      reset();
      onCreated(team);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "team_name_taken") {
        setError("A team with this name already exists.");
      } else if (failure instanceof ApiFailure && failure.status === 400) {
        setError(failure.errors[0]?.message ?? "Please check the name and try again.");
      } else {
        setError("Something went wrong. Please try again.");
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
        <Button>New team</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New team</DialogTitle>
          <DialogDescription>Team names are unique, whatever the letter case.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <label htmlFor="new-team-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="new-team-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              aria-invalid={error !== null}
              aria-describedby={error === null ? undefined : "new-team-name-error"}
              autoComplete="off"
            />
            {error !== null && (
              <p id="new-team-name-error" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Create team
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
