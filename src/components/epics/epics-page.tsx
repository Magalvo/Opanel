"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { getProject } from "@/components/projects/api";
import { useProject } from "@/components/projects/project-frame";
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
import type { Epic, EpicPage } from "@/lib/schemas/epics";

import { type EpicsShow, listEpics } from "./api";
import { EpicDialog } from "./epic-dialog";
import { EpicProgress } from "./epic-progress";
import { NewEpicDialog } from "./new-epic-dialog";

export type { EpicsShow } from "./api";

type Phase = "loading" | "error" | "ready";

const SHOW_LABELS: Record<EpicsShow, string> = { open: "Open", closed: "Closed", all: "All" };

const EMPTY: Record<EpicsShow, string> = {
  open: "No open epics.",
  closed: "No closed epics.",
  all: "No epics yet.",
};

/**
 * A project's epics (WS-039): a table with status, dates and progress, a Show choice kept in
 * the URL, and, for those who may manage epics on a writable project, creating, editing,
 * closing and reopening them.
 */
export function EpicsPage({
  show,
  canManageEpics,
}: Readonly<{ show: EpicsShow; canManageEpics: boolean }>) {
  const id = useId();
  const router = useRouter();
  const { project, setProject } = useProject();
  const projectKey = project.key;
  const archived = project.archivedAt !== null;
  const writable = canManageEpics && !archived;

  const [epics, setEpics] = useState<Epic[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState("");
  // The open epic, and the title button that gets the focus back when it closes.
  const [opened, setOpened] = useState<{ id: string; opener: HTMLElement } | null>(null);

  function showFirstPage(page: EpicPage) {
    setEpics(page.items);
    setNextCursor(page.nextCursor);
    setPhase("ready");
  }

  useEffect(() => {
    let cancelled = false;
    listEpics(projectKey, show).then(
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
  }, [projectKey, show]);

  function retry() {
    setPhase("loading");
    listEpics(projectKey, show).then(showFirstPage, () => {
      setPhase("error");
    });
  }

  async function loadMore() {
    if (nextCursor === null) return;
    try {
      const page = await listEpics(projectKey, show, nextCursor);
      setEpics((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setMessage("Could not load more epics. Try again.");
    }
  }

  function failed(failure: unknown, fallback: string) {
    if (failure instanceof ApiFailure && failure.code === "project_archived") {
      setMessage("The project is archived.");
      getProject(projectKey).then(setProject, () => undefined);
      return;
    }
    setMessage(fallback);
  }

  function changed(epic: Epic, text: string) {
    setEpics((current) => current.map((item) => (item.id === epic.id ? epic : item)));
    setMessage(text);
  }

  // An epic that no longer matches the list stays until its dialog closes.
  const shown = epics.filter(
    (epic) => show === "all" || epic.status === show || epic.id === opened?.id,
  );
  const openEpic = opened === null ? undefined : epics.find((epic) => epic.id === opened.id);

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-show`} className="text-sm font-medium">
            Show
          </label>
          <select
            id={`${id}-show`}
            value={show}
            onChange={(event) => {
              const next = event.target.value;
              router.push(
                next === "closed" || next === "all"
                  ? `/projects/${projectKey}/epics?show=${next}`
                  : `/projects/${projectKey}/epics`,
              );
            }}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
          >
            {(Object.keys(SHOW_LABELS) as EpicsShow[]).map((option) => (
              <option key={option} value={option}>
                {SHOW_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
        {writable && (
          <NewEpicDialog
            projectKey={projectKey}
            onCreated={(epic) => {
              if (show !== "closed") setEpics((current) => [...current, epic]);
              setMessage(`${epic.title} was created.`);
            }}
            onFailure={failed}
          />
        )}
      </div>

      {archived && (
        <p className="text-sm text-muted-foreground">
          This project is archived. Its epics are read-only.
        </p>
      )}
      <p role="status" aria-label="Epic messages" className="min-h-5 text-sm">
        {message}
      </p>

      {phase === "loading" && (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">Loading epics…</p>
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {phase === "error" && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            Could not load the epics.
          </p>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      )}

      {phase === "ready" && shown.length === 0 && (
        <p className="text-sm text-muted-foreground">{EMPTY[show]}</p>
      )}

      {phase === "ready" && shown.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Start</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Progress</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((epic) => (
              <TableRow key={epic.id}>
                <TableCell className="max-w-64 whitespace-normal">
                  <button
                    type="button"
                    className="text-left break-words underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                    onClick={(event) => {
                      setOpened({ id: epic.id, opener: event.currentTarget });
                    }}
                  >
                    {epic.title}
                  </button>
                </TableCell>
                <TableCell>
                  <Badge variant={epic.status === "open" ? "secondary" : "outline"}>
                    {epic.status === "open" ? "Open" : "Closed"}
                  </Badge>
                </TableCell>
                <TableCell>{epic.startDate ?? "—"}</TableCell>
                <TableCell>{epic.targetDate ?? "—"}</TableCell>
                <TableCell>
                  <EpicProgress progress={epic.progress} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {phase === "ready" && nextCursor !== null && (
        <div>
          <Button variant="outline" onClick={() => void loadMore()}>
            Load more
          </Button>
        </div>
      )}

      {opened !== null && openEpic !== undefined && (
        <EpicDialog
          epic={openEpic}
          writable={writable}
          returnFocusTo={opened.opener}
          message={message}
          onClose={() => {
            setOpened(null);
          }}
          onChanged={changed}
          onFailure={failed}
        />
      )}
    </div>
  );
}
