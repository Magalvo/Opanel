"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { Epic } from "@/lib/schemas/epics";
import type { Project } from "@/lib/schemas/projects";

import { type EpicFilter, listEpics } from "./api";
import { CreateEpicDialog } from "./create-epic-dialog";
import { EpicDialog } from "./epic-dialog";
import { EpicsTable } from "./epics-table";

type Phase = "loading" | "error" | "ready";

const FILTER_LABELS: Record<EpicFilter, string> = { open: "Open", closed: "Closed", all: "All" };
const FILTERS: EpicFilter[] = ["open", "closed", "all"];

function byTitle(a: Epic, b: Epic): number {
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

function isFilter(value: string): value is EpicFilter {
  return FILTERS.some((filter) => filter === value);
}

export interface EpicsPageProps {
  project: Project;
  canManage: boolean;
  archived: boolean;
}

/** A project's epics (WS-039): everyone reads them, a Manager or Admin changes them. */
export function EpicsPage({ project, canManage, archived }: Readonly<EpicsPageProps>) {
  const [epics, setEpics] = useState<Epic[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [filter, setFilter] = useState<EpicFilter>("open");
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState("");
  const [archivedNow, setArchivedNow] = useState(false);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const writable = canManage && !archived && !archivedNow;
  const opened = epics.find((epic) => epic.id === openedId);

  useEffect(() => {
    let cancelled = false;
    listEpics(project.id, filter).then(
      (page) => {
        if (cancelled) return;
        setEpics(page.items);
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
  }, [project.id, filter]);

  // A dialog opened by code has no trigger for Radix to give focus back to.
  useEffect(() => {
    if (openedId === null && opener.current !== null) {
      opener.current.focus();
      opener.current = null;
    }
  }, [openedId]);

  function show(next: EpicFilter) {
    setPhase("loading");
    setMessage("");
    setFilter(next);
  }

  function retry() {
    setPhase("loading");
    listEpics(project.id, filter).then(
      (page) => {
        setEpics(page.items);
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
      const page = await listEpics(project.id, filter, nextCursor);
      setEpics((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setMessage("Could not load more epics. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  function matches(epic: Epic): boolean {
    return filter === "all" || epic.status === filter;
  }

  function created(epic: Epic) {
    if (matches(epic)) setEpics((current) => [...current, epic].sort(byTitle));
    setMessage(`Created ${epic.title}.`);
  }

  function changed(epic: Epic) {
    setEpics((current) => current.map((other) => (other.id === epic.id ? epic : other)));
  }

  function statusChanged(epic: Epic) {
    setOpenedId(null);
    setEpics((current) =>
      matches(epic)
        ? current.map((other) => (other.id === epic.id ? epic : other))
        : current.filter((other) => other.id !== epic.id),
    );
    setMessage(`${epic.status === "closed" ? "Closed" : "Reopened"} ${epic.title}.`);
  }

  return (
    <div className="grid max-w-5xl gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Epics</h1>
        {writable && (
          <CreateEpicDialog
            projectId={project.id}
            onCreated={created}
            onArchived={() => {
              setArchivedNow(true);
              setMessage("The project is archived, so its epics are read-only.");
            }}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Show</span>
        <Select
          value={filter}
          onValueChange={(value) => {
            if (isFilter(value)) show(value);
          }}
        >
          <SelectTrigger aria-label="Show" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((option) => (
              <SelectItem key={option} value={option}>
                {FILTER_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div
        role="status"
        aria-label="Epic messages"
        className="min-h-5 text-sm text-muted-foreground"
      >
        {message}
      </div>
      {(archived || archivedNow) && (
        <p className="text-sm text-muted-foreground">
          This project is archived, so its epics are read-only.
        </p>
      )}

      {phase === "loading" && (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">Loading epics…</p>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {phase === "error" && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            Could not load epics.
          </p>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      )}

      {phase === "ready" && (
        <>
          {epics.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {filter === "all" ? "There are no epics yet." : `There are no ${filter} epics.`}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <EpicsTable
                epics={epics}
                onOpen={(epic, button) => {
                  opener.current = button;
                  setOpenedId(epic.id);
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

      {opened !== undefined && (
        <EpicDialog
          key={opened.id}
          epic={opened}
          writable={writable}
          onChanged={changed}
          onStatusChanged={statusChanged}
          onArchived={() => {
            setArchivedNow(true);
          }}
          onClose={() => {
            setOpenedId(null);
          }}
        />
      )}
    </div>
  );
}
