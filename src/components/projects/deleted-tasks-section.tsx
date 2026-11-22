"use client";

import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiFailure } from "@/lib/api-client";
import type { TaskSummary } from "@/lib/schemas/tasks";

import { listDeletedTasks, restoreTask } from "./api";
import { useProjectEventListener } from "./project-events";
import { useProject } from "./project-frame";

/** Deleted tasks of the project, each of which can be restored (WS-036 section 5). */
export function DeletedTasksSection({
  announce,
  readOnly,
}: Readonly<{ announce: (message: string) => void; readOnly: boolean }>) {
  const id = useId();
  const { project } = useProject();
  const projectKey = project.key;
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [failedToLoad, setFailedToLoad] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listDeletedTasks(projectKey).then(
      (page) => {
        if (cancelled) return;
        setTasks(page.items);
        setNextCursor(page.nextCursor);
      },
      () => {
        if (!cancelled) setFailedToLoad(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectKey]);

  /**
   * Reads the list again from the start, as many as are shown (WS-049 section 5): a task
   * deleted or restored elsewhere, or a reconnect.
   */
  async function reloadShown() {
    const count = tasks?.length ?? 0;
    const read: TaskSummary[] = [];
    let next: string | null = null;
    try {
      do {
        const page = await listDeletedTasks(projectKey, next ?? undefined);
        read.push(...page.items);
        next = page.nextCursor;
      } while (next !== null && read.length < count);
      setTasks(read);
      setNextCursor(next);
      setFailedToLoad(false);
    } catch {
      // The list shown stays; the next event or reconnect tries again.
    }
  }

  useProjectEventListener({
    onEvent: (event) => {
      if (event.type === "task.deleted" || event.type === "task.restored") void reloadShown();
    },
    onReconnect: () => void reloadShown(),
  });

  async function loadMore() {
    if (nextCursor === null) return;
    setLoadingMore(true);
    try {
      const page = await listDeletedTasks(projectKey, nextCursor);
      setTasks((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      announce("Could not load more deleted tasks. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function restore(task: TaskSummary) {
    try {
      await restoreTask(task.id);
      setTasks((current) => (current ?? []).filter((other) => other.id !== task.id));
      // A task deleted from the backlog goes back there (WS-101).
      announce(
        `${task.key} was restored to ${task.columnId === null ? "the backlog" : "its column"}.`,
      );
    } catch (failure) {
      announce(
        failure instanceof ApiFailure && failure.code === "project_archived"
          ? "The project is archived."
          : `Could not restore ${task.key}. Try again.`,
      );
    }
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="grid gap-4">
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        Deleted tasks
      </h2>
      {failedToLoad && (
        <p role="alert" className="text-sm text-destructive">
          Could not load the deleted tasks.
        </p>
      )}
      {tasks === null && !failedToLoad && (
        <p className="text-sm text-muted-foreground">Loading deleted tasks…</p>
      )}
      {tasks?.length === 0 && <p className="text-sm text-muted-foreground">No deleted tasks.</p>}
      {tasks !== null && tasks.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Task</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Deleted</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell className="font-mono text-xs">{task.key}</TableCell>
                  <TableCell className="max-w-0 truncate">{task.title}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {task.deletedAt === null ? "" : new Date(task.deletedAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Restore ${task.key}`}
                      disabled={readOnly}
                      onClick={() => void restore(task)}
                    >
                      Restore
                    </Button>
                  </TableCell>
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
    </section>
  );
}
