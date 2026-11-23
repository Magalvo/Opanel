"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiFailure } from "@/lib/api-client";
import type { Project } from "@/lib/schemas/projects";
import { cn } from "@/lib/utils";

import { getProject } from "./api";
import { ProjectEventsProvider } from "./project-events";

type Phase = "loading" | "missing" | "error" | "ready";

interface ProjectContextValue {
  project: Project;
  /** Shows a project the API returned after a change, in the header and the pages. */
  setProject: (project: Project) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

/** The project of the page, for components inside `ProjectFrame`. */
export function useProject(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (value === null) throw new Error("useProject is used outside ProjectFrame.");
  return value;
}

/**
 * Every page of a project (WS-036): loads the project once, shows its header and navigation,
 * and gives the page the project through `useProject`. The page is shown only once the
 * project is loaded.
 */
export function ProjectFrame({
  projectKey,
  canManageProjects,
  children,
  modal = null,
}: Readonly<{
  projectKey: string;
  canManageProjects: boolean;
  children: ReactNode;
  /** The `@modal` slot: a task opened over the board (WS-038). */
  modal?: ReactNode;
}>) {
  const pathname = usePathname();
  const [project, setProject] = useState<Project | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");

  function failed(failure: unknown) {
    setPhase(failure instanceof ApiFailure && failure.status === 404 ? "missing" : "error");
  }

  useEffect(() => {
    let cancelled = false;
    getProject(projectKey).then(
      (loaded) => {
        if (cancelled) return;
        setProject(loaded);
        setPhase("ready");
      },
      (failure: unknown) => {
        if (!cancelled) failed(failure);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectKey]);

  function retry() {
    setPhase("loading");
    getProject(projectKey).then((loaded) => {
      setProject(loaded);
      setPhase("ready");
    }, failed);
  }

  const boardHref = `/projects/${projectKey}` as const;
  const backlogHref = `/projects/${projectKey}/backlog` as const;
  const settingsHref = `/projects/${projectKey}/settings` as const;
  const epicsHref = `/projects/${projectKey}/epics` as const;
  // A task, as a dialog or as its own page, belongs to the list it was opened from: the
  // board or the backlog (WS-038, WS-109 section 1). The frame stays mounted across them,
  // so it remembers the last one; a task loaded directly belongs to the board.
  const [lastList, setLastList] = useState<"board" | "backlog">(
    pathname === backlogHref ? "backlog" : "board",
  );
  const shownList = pathname === boardHref ? "board" : pathname === backlogHref ? "backlog" : null;
  if (shownList !== null && shownList !== lastList) setLastList(shownList);
  const onTask = pathname.startsWith(`${boardHref}/tasks/`);
  const onBoard = pathname === boardHref || (onTask && lastList === "board");
  const onBacklog = pathname === backlogHref || (onTask && lastList === "backlog");

  function tabClass(current: boolean) {
    return cn(
      "-mb-px border-b-2 px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
      current
        ? "border-foreground font-medium text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground",
    );
  }

  return (
    <div className="grid gap-4">
      <div>
        <Link
          href="/projects"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:underline"
        >
          All projects
        </Link>
      </div>

      {phase === "loading" && (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">Loading the project…</p>
          <Skeleton className="h-8 w-48" />
        </div>
      )}

      {phase === "missing" && <p className="text-sm">This project does not exist.</p>}

      {phase === "error" && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            Could not load the project.
          </p>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      )}

      {phase === "ready" && project !== null && (
        <ProjectContext value={{ project, setProject }}>
          <header className="grid gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="min-w-0 text-2xl font-semibold tracking-tight break-words">
                {project.name}
              </h1>
              <span className="font-mono text-xs text-muted-foreground">{project.key}</span>
              {project.archivedAt !== null && <Badge variant="secondary">Archived</Badge>}
            </div>
            <nav aria-label="Project" className="flex gap-1 border-b">
              <Link
                href={boardHref}
                aria-current={onBoard ? "page" : undefined}
                className={tabClass(onBoard)}
              >
                Board
              </Link>
              <Link
                href={backlogHref}
                aria-current={onBacklog ? "page" : undefined}
                className={tabClass(onBacklog)}
              >
                Backlog
              </Link>
              <Link
                href={epicsHref}
                aria-current={pathname === epicsHref ? "page" : undefined}
                className={tabClass(pathname === epicsHref)}
              >
                Epics
              </Link>
              {canManageProjects && (
                <Link
                  href={settingsHref}
                  aria-current={pathname === settingsHref ? "page" : undefined}
                  className={tabClass(pathname === settingsHref)}
                >
                  Settings
                </Link>
              )}
            </nav>
          </header>
          {/* One events stream for the page and the task dialog over it (WS-049). */}
          <ProjectEventsProvider project={project} setProject={setProject}>
            {children}
            {modal}
          </ProjectEventsProvider>
        </ProjectContext>
      )}
    </div>
  );
}
