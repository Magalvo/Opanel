"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiFailure } from "@/lib/api-client";
import type { Person } from "@/lib/schemas/people";
import type { Team } from "@/lib/schemas/teams";

import { AddMemberDialog } from "./add-member-dialog";
import { deleteTeam, getTeam, removeMember, renameTeam } from "./api";
import { TeamNameDialog } from "./team-name-dialog";

type Phase = "loading" | "missing" | "error" | "ready";

const IN_USE = "Tasks are assigned to this team. Assign them elsewhere before deleting it.";

/** One team and its members (WS-035). Managers and Admins also change it here. */
export function TeamPage({
  teamId,
  canManageTeams,
}: Readonly<{ teamId: string; canManageTeams: boolean }>) {
  const router = useRouter();
  const [team, setTeam] = useState<Team | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function load(): Promise<void> {
    return getTeam(teamId).then(
      (loaded) => {
        setTeam(loaded);
        setPhase("ready");
      },
      (failure: unknown) => {
        setPhase(failure instanceof ApiFailure && failure.status === 404 ? "missing" : "error");
      },
    );
  }

  useEffect(() => {
    let cancelled = false;
    getTeam(teamId).then(
      (loaded) => {
        if (cancelled) return;
        setTeam(loaded);
        setPhase("ready");
      },
      (failure: unknown) => {
        if (cancelled) return;
        setPhase(failure instanceof ApiFailure && failure.status === 404 ? "missing" : "error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  async function rename(name: string) {
    const renamed = await renameTeam(teamId, name);
    setTeam(renamed);
    setMessage(`The team is now called ${renamed.name}.`);
  }

  async function remove(current: Team, person: Person) {
    try {
      await removeMember(current.id, person.id);
      setTeam((shown) =>
        shown === null
          ? shown
          : { ...shown, members: shown.members.filter((member) => member.id !== person.id) },
      );
      setMessage(`${person.name} was removed from ${current.name}.`);
    } catch {
      setMessage(`Could not remove ${person.name}. Try again.`);
    }
  }

  async function destroy(current: Team) {
    try {
      await deleteTeam(current.id);
      router.push("/teams");
    } catch (failure) {
      setMessage(
        failure instanceof ApiFailure && failure.code === "team_in_use"
          ? IN_USE
          : "Could not delete the team. Try again.",
      );
    }
  }

  return (
    <div className="grid max-w-3xl gap-4">
      <div>
        <Link
          href="/teams"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:underline"
        >
          All teams
        </Link>
      </div>

      {phase === "loading" && (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">Loading the team…</p>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {phase === "missing" && <p className="text-sm">This team does not exist.</p>}

      {phase === "error" && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            Could not load the team.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPhase("loading");
              void load();
            }}
          >
            Retry
          </Button>
        </div>
      )}

      {phase === "ready" && team !== null && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="min-w-0 text-2xl font-semibold tracking-tight break-words">
              {team.name}
            </h1>
            {canManageTeams && (
              <div className="flex flex-wrap gap-2">
                <AddMemberDialog
                  team={team}
                  onAdded={(updated, person) => {
                    setTeam(updated);
                    setMessage(`${person.name} was added to ${updated.name}.`);
                  }}
                />
                <TeamNameDialog
                  key={team.name}
                  trigger={<Button variant="outline">Rename</Button>}
                  title="Rename team"
                  description="Tasks assigned to the team keep it."
                  submitLabel="Save"
                  initialName={team.name}
                  onSubmit={rename}
                />
                <Button
                  variant="destructive"
                  onClick={() => {
                    setConfirmingDelete(true);
                  }}
                >
                  Delete team
                </Button>
                <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {team.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Its members stay; only the team goes.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => {
                          setConfirmingDelete(false);
                          void destroy(team);
                        }}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>

          {team.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  {canManageTeams && <TableHead className="w-24 text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {team.members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="max-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{member.name}</span>
                        {!member.active && <Badge variant="secondary">Deactivated</Badge>}
                      </div>
                    </TableCell>
                    {canManageTeams && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${member.name} from ${team.name}`}
                          onClick={() => void remove(team, member)}
                        >
                          Remove
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}

      <div role="status" className="min-h-5 text-sm text-muted-foreground">
        {message}
      </div>
    </div>
  );
}
