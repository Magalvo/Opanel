"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
import { usePagedList } from "@/hooks/use-paged-list";
import type { TeamPage as TeamListPage, TeamSummary } from "@/lib/schemas/teams";

import { createTeam, listTeams } from "./api";
import { TeamNameDialog } from "./team-name-dialog";

type Phase = "loading" | "error" | "ready";

/** The list of teams (WS-035). Managers and Admins also create teams here. */
export function TeamsPage({ canManageTeams }: Readonly<{ canManageTeams: boolean }>) {
  const router = useRouter();
  const list = usePagedList<TeamSummary>();
  const { items: teams, nextCursor, loadingMore, show } = list;
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState("");

  function showFirstPage(page: TeamListPage) {
    show(page);
    setPhase("ready");
  }

  useEffect(() => {
    let cancelled = false;
    listTeams().then(
      (page) => {
        if (cancelled) return;
        show(page);
        setPhase("ready");
      },
      () => {
        if (!cancelled) setPhase("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [show]);

  function retry() {
    setPhase("loading");
    listTeams().then(showFirstPage, () => {
      setPhase("error");
    });
  }

  async function loadMore() {
    try {
      await list.loadMore((cursor) => listTeams(cursor));
    } catch {
      setMessage("Could not load more teams. Try again.");
    }
  }

  async function create(name: string) {
    const team = await createTeam(name);
    setMessage(`Created ${team.name}.`);
    router.push(`/teams/${team.id}`);
  }

  return (
    <div className="grid max-w-3xl gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
        {canManageTeams && (
          <TeamNameDialog
            trigger={<Button>New team</Button>}
            title="New team"
            description="People can be added once the team exists."
            submitLabel="Create team"
            onSubmit={create}
          />
        )}
      </div>

      <div role="status" className="min-h-5 text-sm text-muted-foreground">
        {message}
      </div>

      {phase === "loading" && (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">Loading teams…</p>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {phase === "error" && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            Could not load teams.
          </p>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      )}

      {phase === "ready" && teams.length === 0 && (
        <p className="text-sm text-muted-foreground">No teams yet.</p>
      )}

      {phase === "ready" && teams.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead className="w-24 text-right">Members</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.map((team) => (
                <TableRow key={team.id}>
                  <TableCell className="max-w-0 truncate">
                    <Link
                      href={`/teams/${team.id}`}
                      className="font-medium underline-offset-4 hover:underline focus-visible:underline"
                    >
                      {team.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{team.memberCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {nextCursor !== null && (
            <div>
              <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
