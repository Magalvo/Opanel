"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Project } from "@/lib/schemas/projects";

import { listProjects } from "./api";
import { CreateProjectDialog } from "./create-project-dialog";
import { ProjectsTable } from "./projects-table";

type Phase = "loading" | "error" | "ready";

/** The projects list (WS-036): everyone reads it, a Manager or Admin creates projects. */
export function ProjectsPage({ canManage }: Readonly<{ canManage: boolean }>) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [archived, setArchived] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    listProjects(archived).then(
      (page) => {
        if (cancelled) return;
        setProjects(page.items);
        setNextCursor(page.nextCursor);
        setPhase("ready");
      },
      () => {
        if (!cancelled) setPhase("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [archived]);

  function reload(next: boolean) {
    setPhase("loading");
    setMessage("");
    setArchived(next);
  }

  function retry() {
    setPhase("loading");
    listProjects(archived).then(
      (page) => {
        setProjects(page.items);
        setNextCursor(page.nextCursor);
        setPhase("ready");
      },
      () => {
        setPhase("error");
      },
    );
  }

  async function loadMore() {
    if (nextCursor === null) return;
    setLoadingMore(true);
    try {
      const page = await listProjects(archived, nextCursor);
      setProjects((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setMessage("Could not load more projects. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="grid max-w-5xl gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        {canManage && <CreateProjectDialog />}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={archived}
          onChange={(event) => {
            reload(event.target.checked);
          }}
          className="size-4"
        />
        Show archived
      </label>

      <div role="status" className="min-h-5 text-sm text-muted-foreground">
        {message}
      </div>

      {phase === "loading" && (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">Loading projects…</p>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {phase === "error" && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            Could not load projects.
          </p>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      )}

      {phase === "ready" && (
        <>
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {archived ? "There are no archived projects." : "There are no projects yet."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <ProjectsTable projects={projects} />
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
    </div>
  );
}
