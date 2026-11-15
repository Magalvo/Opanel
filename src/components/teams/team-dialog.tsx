"use client";

import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Person } from "@/lib/schemas/people";
import { type Team, teamNameSchema, type TeamSummary } from "@/lib/schemas/teams";

import {
  addMember,
  ApiFailure,
  deleteTeam,
  getTeam,
  removeMember,
  renameTeam,
  searchPeople,
} from "./api";

const SEARCH_PAUSE_MS = 250;

export interface TeamDialogProps {
  team: TeamSummary;
  canManage: boolean;
  /** The team as it is now, after a rename or a change of members. */
  onChanged: (team: Team) => void;
  /** `how` tells the page what to say: it was deleted by this person, or was already gone. */
  onGone: (team: TeamSummary, how: "deleted" | "missing" | "in_use") => void;
  onClose: () => void;
}

/** A team's members, and for a Manager the controls to change the team (WS-035). */
export function TeamDialog({
  team: summary,
  canManage,
  onChanged,
  onGone,
  onClose,
}: Readonly<TeamDialogProps>) {
  const [team, setTeam] = useState<Team | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [message, setMessage] = useState("");
  const [name, setName] = useState(summary.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<Person[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getTeam(summary.id).then(
      (loaded) => {
        if (cancelled) return;
        setTeam(loaded);
        setName(loaded.name);
      },
      (failure: unknown) => {
        if (cancelled) return;
        if (failure instanceof ApiFailure && failure.status === 404) {
          onGone(summary, "missing");
        } else {
          setLoadFailed(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // The team is loaded once per opening; `onGone` is a stable intent, not an input.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reason: load once per team id
  }, [summary.id]);

  const members = team?.members ?? [];
  const title = team?.name ?? summary.name;

  useEffect(() => {
    const text = search.trim();
    if (!canManage || text === "") {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchPeople(text).then(
        (page) => {
          if (!cancelled) setFound(page.items);
        },
        () => {
          if (!cancelled) setFound([]);
        },
      );
    }, SEARCH_PAUSE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, canManage]);

  function update(next: Team, said: string) {
    setTeam(next);
    setName(next.name);
    setMessage(said);
    onChanged(next);
  }

  function gone(failure: unknown, fallback: string) {
    if (failure instanceof ApiFailure && failure.status === 404) {
      onGone(summary, "missing");
    } else {
      setMessage(fallback);
    }
  }

  async function rename(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = teamNameSchema.safeParse(name);
    if (!parsed.success) {
      setNameError("A name is required, up to 100 characters.");
      return;
    }
    setNameError(null);
    try {
      const renamed = await renameTeam(summary.id, parsed.data);
      update(renamed, `Renamed the team to ${renamed.name}.`);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "team_name_taken") {
        setNameError("A team with this name already exists.");
      } else {
        gone(failure, "Could not rename the team. Try again.");
      }
    }
  }

  async function add(person: Person) {
    try {
      const updated = await addMember(summary.id, person.id);
      setSearch("");
      update(updated, `Added ${person.name} to ${updated.name}.`);
    } catch (failure) {
      gone(failure, `Could not add ${person.name}. Try again.`);
    }
  }

  async function remove(person: Person) {
    try {
      await removeMember(summary.id, person.id);
      const updated: Team = {
        ...(team ?? {
          id: summary.id,
          name: summary.name,
          createdAt: summary.createdAt,
          updatedAt: summary.createdAt,
        }),
        members: members.filter((member) => member.id !== person.id),
      };
      update(updated, `Removed ${person.name} from ${updated.name}.`);
    } catch (failure) {
      gone(failure, `Could not remove ${person.name}. Try again.`);
    }
  }

  async function confirmDelete() {
    setConfirmingDelete(false);
    try {
      await deleteTeam(summary.id);
      onGone(summary, "deleted");
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "team_in_use") {
        onGone(summary, "in_use");
      } else {
        gone(failure, "Could not delete the team. Try again.");
      }
    }
  }

  const memberIds = new Set(members.map((member) => member.id));
  // Results of an earlier search are not shown once the field is empty again.
  const candidates =
    search.trim() === ""
      ? []
      : found.filter((person) => person.active && !memberIds.has(person.id));

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`Team ${title}`}</DialogTitle>
            <DialogDescription>
              {canManage ? "Rename the team or change who is in it." : "The people in this team."}
            </DialogDescription>
          </DialogHeader>

          <div role="status" className="min-h-5 text-sm text-muted-foreground">
            {message}
          </div>

          {canManage && (
            <form onSubmit={(event) => void rename(event)} className="grid gap-1.5" noValidate>
              <label htmlFor="team-name" className="text-sm font-medium">
                Team name
              </label>
              <div className="flex gap-2">
                <Input
                  id="team-name"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                  aria-invalid={nameError !== null}
                  aria-describedby={nameError === null ? undefined : "team-name-error"}
                  autoComplete="off"
                />
                <Button type="submit" variant="outline">
                  Rename
                </Button>
              </div>
              {nameError !== null && (
                <p id="team-name-error" className="text-sm text-destructive">
                  {nameError}
                </p>
              )}
            </form>
          )}

          {loadFailed && (
            <p role="alert" className="text-sm text-destructive">
              Could not load the members.
            </p>
          )}
          {team !== null && members.length === 0 && (
            <p className="text-sm text-muted-foreground">No members yet.</p>
          )}
          {members.length > 0 && (
            <ul aria-label="Members" className="grid gap-1">
              {members.map((member) => (
                <li key={member.id} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span>{member.name}</span>
                    {!member.active && <Badge variant="default">Deactivated</Badge>}
                  </span>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${member.name}`}
                      onClick={() => void remove(member)}
                    >
                      <XIcon aria-hidden="true" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canManage && (
            <div className="grid gap-1.5">
              <label htmlFor="team-add-person" className="text-sm font-medium">
                Add a person
              </label>
              <Input
                id="team-add-person"
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
                autoComplete="off"
              />
              {candidates.length > 0 && (
                <ul aria-label="People found" className="grid gap-1">
                  {candidates.map((person) => (
                    <li key={person.id} className="flex items-center justify-between gap-2">
                      <span>{person.name}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Add ${person.name}`}
                        onClick={() => void add(person)}
                      >
                        Add
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {canManage && (
            <div className="border-t pt-3">
              <Button
                variant="destructive"
                onClick={() => {
                  setConfirmingDelete(true);
                }}
              >
                Delete team
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this team?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the team and its memberships. The people stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
