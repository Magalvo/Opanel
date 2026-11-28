"use client";

import { RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { isEmpty, type TaskFilter } from "@/components/filters/task-filter";
import { TaskFilterBar } from "@/components/filters/task-filter-bar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePagedList } from "@/hooks/use-paged-list";
import { useToday } from "@/hooks/use-today";
import { ApiFailure } from "@/lib/api-client";
import type { TaskListItem, TaskSort } from "@/lib/schemas/tasks";

import { listOpenProjects, listTaskItems } from "./api";
import { TaskListTable } from "./task-list-table";
import { useUrlTaskList } from "./use-url-task-list";

type Phase = "loading" | "ready" | "error";

interface ProjectOption {
  value: string;
  label: string;
  id: string;
}

/** What a failed read says: the refused fields of a `400`, or that it failed. */
function failureText(error: unknown): string {
  if (error instanceof ApiFailure && error.status === 400 && error.errors.length > 0) {
    const fields = [...new Set(error.errors.map((field) => field.path))].join(", ");
    return `Some filters are not valid: ${fields}.`;
  }
  return "The tasks could not be loaded.";
}

function statusText(count: number, more: boolean): string {
  const tasks = count === 1 ? "1 task" : `${String(count)} tasks`;
  return more ? `Showing ${tasks}; more to load.` : `Showing ${tasks}.`;
}

/** The one project a filter names, by key, when it names exactly one. */
function oneProjectKey(filter: TaskFilter, projects: readonly ProjectOption[]): string | null {
  const named = filter.projectId ?? [];
  if (named.length !== 1) return null;
  const [value = ""] = named;
  return projects.find((project) => project.id === value)?.value ?? value;
}

function uniquePeople(items: readonly TaskListItem[]): { id: string; name: string }[] {
  const people = new Map<string, string>();
  for (const item of items) {
    if (item.assignee !== null) people.set(item.assignee.id, item.assignee.name);
  }
  return [...people].map(([id, name]) => ({ id, name }));
}

/**
 * The list view (WS-130 section 4): the tasks of every project the viewer may read, filtered
 * and sorted as the URL says, 50 at a time. Not live: it reads again when the filter or the
 * order changes, and on Refresh (WT-08 question 5).
 */
export function TaskList() {
  const { filter, sort, ignored, setFilter, setSort } = useUrlTaskList();
  const list = usePagedList<TaskListItem>();
  const { items, nextCursor, loadingMore, show, invalidate } = list;
  const [phase, setPhase] = useState<Phase>("loading");
  const [failure, setFailure] = useState("");
  const [moreFailed, setMoreFailed] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const today = useToday();
  // Only the latest read is applied: a slower answer for an old order or filter is dropped.
  const latest = useRef(0);

  const read = useCallback(
    (readFilter: TaskFilter, readSort: TaskSort) => {
      latest.current += 1;
      const id = latest.current;
      invalidate();
      listTaskItems(readSort, readFilter).then(
        (page) => {
          if (id !== latest.current) return;
          show(page);
          setNow(new Date());
          setPhase("ready");
        },
        (error: unknown) => {
          if (id !== latest.current) return;
          setFailure(failureText(error));
          setPhase("error");
        },
      );
    },
    [invalidate, show],
  );

  useEffect(() => {
    read(filter, sort);
  }, [read, filter, sort]);

  useEffect(
    () => () => {
      // Answers that arrive after the page closed are dropped.
      latest.current += 1;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    listOpenProjects().then(
      (list) => {
        if (cancelled) return;
        setProjects(
          list.map((project) => ({ value: project.key, label: project.name, id: project.id })),
        );
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadMore() {
    setMoreFailed(false);
    try {
      await list.loadMore((cursor) => listTaskItems(sort, filter, cursor));
    } catch {
      setMoreFailed(true);
    }
  }

  function retry() {
    setPhase("loading");
    setMoreFailed(false);
    read(filter, sort);
  }

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setMoreFailed(false);
            read(filter, sort);
          }}
        >
          <RefreshCwIcon aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <TaskFilterBar
        filter={filter}
        onChange={setFilter}
        projectKey={oneProjectKey(filter, projects)}
        projects={projects}
        sprints
        people={uniquePeople(items)}
        ignored={ignored}
      />

      <p role="status" aria-label="List status" className="min-h-5 text-sm text-muted-foreground">
        {phase === "ready" && items.length > 0 ? statusText(items.length, nextCursor !== null) : ""}
      </p>

      {phase === "loading" && (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">Loading tasks…</p>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {phase === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <p>{failure}</p>
          <Button variant="outline" size="sm" onClick={retry}>
            Try again
          </Button>
        </div>
      )}

      {phase === "ready" && items.length === 0 && (
        <section
          aria-label="No tasks"
          className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
        >
          {isEmpty(filter) ? (
            <p>No tasks yet.</p>
          ) : (
            <>
              <p>No tasks match these filters.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFilter({});
                }}
              >
                Clear filters
              </Button>
            </>
          )}
        </section>
      )}

      {phase === "ready" && items.length > 0 && (
        <>
          <TaskListTable items={items} sort={sort} onSort={setSort} today={today} now={now} />
          {nextCursor !== null && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
              {moreFailed && (
                <p role="alert" className="text-sm text-destructive">
                  Could not load more tasks. Try again.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
