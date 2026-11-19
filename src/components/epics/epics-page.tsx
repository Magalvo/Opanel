"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { getProject } from "@/components/projects/api";
import { useProjectEventListener } from "@/components/projects/project-events";
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
import { usePagedList } from "@/hooks/use-paged-list";
import { ApiFailure } from "@/lib/api-client";
import type { Epic, EpicPage } from "@/lib/schemas/epics";

import { type EpicsShow, listEpics } from "./api";
import { EpicDialog } from "./epic-dialog";
import { EpicProgress } from "./epic-progress";
import { NewEpicDialog } from "./new-epic-dialog";

export type { EpicsShow } from "./api";

type Phase = "loading" | "error" | "ready";

/** The least time between two live reloads of the list (WS-049 section 4). */
const RELOAD_GAP_MS = 500;

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

  const list = usePagedList<Epic>();
  const { items: epics, nextCursor, loadingMore, show: showPage, invalidate } = list;
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState("");
  // The open epic, and the title button that gets the focus back when it closes.
  const [opened, setOpened] = useState<{ id: string; opener: HTMLElement } | null>(null);

  function showFirstPage(page: EpicPage) {
    showPage(page);
    setPhase("ready");
  }

  useEffect(() => {
    let cancelled = false;
    // A page still loading for the previous project or Show choice is dropped (WS-080).
    invalidate();
    listEpics(projectKey, show).then(
      (page) => {
        if (cancelled) return;
        showPage(page);
        setPhase("ready");
      },
      () => {
        if (!cancelled) setPhase("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectKey, show, showPage, invalidate]);

  function retry() {
    setPhase("loading");
    listEpics(projectKey, show).then(showFirstPage, () => {
      setPhase("error");
    });
  }

  async function loadMore() {
    try {
      await list.loadMore((cursor) => listEpics(projectKey, show, cursor));
    } catch {
      setMessage("Could not load more epics. Try again.");
    }
  }

  // Live (WS-049 section 4): epics and their progress change with epic and task events.
  // Reloads are coalesced: one at a time, at least `RELOAD_GAP_MS` apart, and the events of
  // a running reload cause one more after it.
  const reloading = useRef({ running: false, again: false, last: 0 });
  const latest = useRef({ epics, opened });
  useEffect(() => {
    latest.current = { epics, opened };
  });

  async function reloadShown() {
    const state = reloading.current;
    if (state.running) {
      state.again = true;
      return;
    }
    state.running = true;
    try {
      const wait = state.last + RELOAD_GAP_MS - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      state.last = Date.now();
      const count = latest.current.epics.length;
      const read: Epic[] = [];
      let next: string | null = null;
      do {
        const page = await listEpics(projectKey, show, next ?? undefined);
        read.push(...page.items);
        next = page.nextCursor;
      } while (next !== null && read.length < count);
      // An epic open in its dialog stays, even if it no longer comes back in the list.
      const open = latest.current.opened;
      const kept =
        open === null || read.some((item) => item.id === open.id)
          ? []
          : latest.current.epics.filter((item) => item.id === open.id);
      showPage({ items: [...read, ...kept], nextCursor: next });
    } catch {
      // The list shown stays; the next event or reconnect tries again.
    } finally {
      state.running = false;
      if (state.again) {
        state.again = false;
        void reloadShown();
      }
    }
  }

  useProjectEventListener({
    onEvent: (event) => {
      if (phase !== "ready") return;
      if (event.type === "epic.changed" || event.type.startsWith("task.")) void reloadShown();
    },
    onReconnect: () => {
      if (phase === "ready") void reloadShown();
    },
  });

  function failed(failure: unknown, fallback: string) {
    if (failure instanceof ApiFailure && failure.code === "project_archived") {
      setMessage("The project is archived.");
      getProject(projectKey).then(setProject, () => undefined);
      return;
    }
    setMessage(fallback);
  }

  function changed(epic: Epic, text: string) {
    list.update((current) => current.map((item) => (item.id === epic.id ? epic : item)));
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
              if (show !== "closed") list.add(epic);
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
          <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
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
