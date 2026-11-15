"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Team, TeamSummary } from "@/lib/schemas/teams";

import { listTeams } from "./api";
import { CreateTeamDialog } from "./create-team-dialog";
import { TeamDialog } from "./team-dialog";
import { TeamsTable } from "./teams-table";

type Phase = "loading" | "error" | "ready";

function byName(a: TeamSummary, b: TeamSummary): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function summaryOf(team: Team): TeamSummary {
  return {
    id: team.id,
    name: team.name,
    memberCount: team.members.length,
    createdAt: team.createdAt,
  };
}

/** The "Teams" page (WS-035): everyone reads it, a Manager or Admin changes teams. */
export function TeamsPage({ canManage }: Readonly<{ canManage: boolean }>) {
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState("");
  const [opened, setOpened] = useState<TeamSummary | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  // A dialog opened by code has no trigger for Radix to give focus back to.
  useEffect(() => {
    if (opened === null && opener.current !== null) {
      opener.current.focus();
      opener.current = null;
    }
  }, [opened]);

  function showFirstPage(page: Awaited<ReturnType<typeof listTeams>>) {
    setTeams(page.items);
    setNextCursor(page.nextCursor);
    setPhase("ready");
  }

  useEffect(() => {
    let cancelled = false;
    listTeams().then(
      (page) => {
        if (!cancelled) showFirstPage(page);
      },
      () => {
        if (!cancelled) setPhase("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  function retry() {
    setPhase("loading");
    listTeams().then(showFirstPage, () => {
      setPhase("error");
    });
  }

  async function loadMore() {
    if (nextCursor === null) return;
    setLoadingMore(true);
    try {
      const page = await listTeams(nextCursor);
      setTeams((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setMessage("Could not load more teams. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  function created(team: Team) {
    setTeams((current) => [...current, summaryOf(team)].sort(byName));
    setMessage(`Created ${team.name}.`);
  }

  function changed(team: Team) {
    setTeams((current) =>
      current.map((existing) => (existing.id === team.id ? summaryOf(team) : existing)),
    );
    setOpened((current) => (current?.id === team.id ? summaryOf(team) : current));
  }

  function gone(team: TeamSummary, how: "deleted" | "missing" | "in_use") {
    setOpened(null);
    if (how === "in_use") {
      setMessage("Tasks are assigned to this team. Reassign them first.");
      return;
    }
    setTeams((current) => current.filter((existing) => existing.id !== team.id));
    setMessage(how === "deleted" ? `Deleted ${team.name}.` : "This team no longer exists.");
  }

  return (
    <div className="grid max-w-5xl gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
        {canManage && <CreateTeamDialog onCreated={created} />}
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

      {phase === "ready" && (
        <>
          {teams.length === 0 ? (
            <p className="text-sm text-muted-foreground">There are no teams yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <TeamsTable
                teams={teams}
                canManage={canManage}
                onOpen={(team, button) => {
                  opener.current = button;
                  setOpened(team);
                }}
              />
            </div>
          )}
          {nextCursor !== null && (
            <div>
              <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}

      {opened !== null && (
        <TeamDialog
          key={opened.id}
          team={opened}
          canManage={canManage}
          onChanged={changed}
          onGone={gone}
          onClose={() => {
            setOpened(null);
          }}
        />
      )}
    </div>
  );
}
