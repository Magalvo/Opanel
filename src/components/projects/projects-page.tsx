"use client";

import Link from "next/link";
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
import type { Project, ProjectPage } from "@/lib/schemas/projects";
import { cn } from "@/lib/utils";

import { listProjects } from "./api";
import { NewProjectDialog } from "./new-project-dialog";

export type ProjectsView = "active" | "archived";

type Phase = "loading" | "error" | "ready";

const VIEWS = [
  { view: "active", label: "Active", href: "/projects" },
  { view: "archived", label: "Archived", href: "/projects?view=archived" },
] as const;

/** The projects list (WS-036): active ones, or archived ones on request. */
export function ProjectsPage({
  view,
  canManageProjects,
}: Readonly<{ view: ProjectsView; canManageProjects: boolean }>) {
  const archived = view === "archived";
  const [projects, setProjects] = useState<Project[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState("");

  function showFirstPage(page: ProjectPage) {
    setProjects(page.items);
    setNextCursor(page.nextCursor);
    setPhase("ready");
  }

  useEffect(() => {
    let cancelled = false;
    listProjects(archived).then(
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
  }, [archived]);

  function retry() {
    setPhase("loading");
    listProjects(archived).then(showFirstPage, () => {
      setPhase("error");
    });
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
    <div className="grid max-w-3xl gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        {canManageProjects && <NewProjectDialog />}
      </div>

      <nav aria-label="Project views" className="flex gap-1">
        {VIEWS.map((item) => (
          <Link
            key={item.view}
            href={item.href}
            aria-current={item.view === view ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
              item.view === view
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

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

      {phase === "ready" && projects.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {archived ? "No archived projects." : "No projects yet."}
        </p>
      )}

      {phase === "ready" && projects.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead className="w-32">Key</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow key={project.id}>
                  <TableCell className="max-w-0 truncate">
                    <Link
                      href={`/projects/${project.key}`}
                      className="font-medium underline-offset-4 hover:underline focus-visible:underline"
                    >
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{project.key}</TableCell>
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
