"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { TaskSummary } from "@/lib/schemas/tasks";

import { ApiFailure, listDeletedTasks, restoreTask } from "./api";

export interface DeletedTasksSectionProps {
  projectId: string;
  archived: boolean;
  onMessage: (message: string) => void;
}

/** The project's deleted tasks, loaded when the section is opened, with Restore (WS-036). */
export function DeletedTasksSection({
  projectId,
  archived,
  onMessage,
}: Readonly<DeletedTasksSectionProps>) {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  async function show() {
    setOpen(true);
    setLoadFailed(false);
    try {
      const page = await listDeletedTasks(projectId);
      setTasks(page.items);
      setNextCursor(page.nextCursor);
    } catch {
      setLoadFailed(true);
    }
  }

  async function loadMore() {
    if (nextCursor === null) return;
    setLoadingMore(true);
    try {
      const page = await listDeletedTasks(projectId, nextCursor);
      setTasks((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      onMessage("Could not load more deleted tasks. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function restore(task: TaskSummary) {
    try {
      await restoreTask(task.key);
      setTasks((current) => (current ?? []).filter((other) => other.id !== task.id));
      onMessage(`Restored ${task.key}.`);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "project_archived") {
        onMessage("The project is archived, so the task cannot be restored.");
      } else if (failure instanceof ApiFailure && failure.status === 404) {
        setTasks((current) => (current ?? []).filter((other) => other.id !== task.id));
        onMessage(`${task.key} no longer exists.`);
      } else {
        onMessage(`Could not restore ${task.key}. Try again.`);
      }
    }
  }

  return (
    <section aria-labelledby="deleted-heading" className="grid gap-3">
      <h2 id="deleted-heading" className="text-lg font-semibold">
        Deleted tasks
      </h2>
      {!open && (
        <div>
          <Button variant="outline" onClick={() => void show()}>
            Show deleted tasks
          </Button>
        </div>
      )}
      {open && loadFailed && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            Could not load the deleted tasks.
          </p>
          <Button variant="outline" size="sm" onClick={() => void show()}>
            Retry
          </Button>
        </div>
      )}
      {open && tasks !== null && tasks.length === 0 && (
        <p className="text-sm text-muted-foreground">No deleted tasks.</p>
      )}
      {tasks !== null && tasks.length > 0 && (
        <ul aria-label="Deleted tasks" className="grid max-w-3xl gap-2">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2"
            >
              <span className="flex flex-wrap items-center gap-x-3">
                <span className="font-mono text-xs">{task.key}</span>
                <span>{task.title}</span>
                <span className="text-xs text-muted-foreground">
                  {task.deletedAt === null ? "" : new Date(task.deletedAt).toLocaleString()}
                </span>
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={archived}
                aria-label={`Restore ${task.key}`}
                onClick={() => void restore(task)}
              >
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
      {nextCursor !== null && (
        <div>
          <Button
            variant="outline"
            disabled={loadingMore}
            aria-label="Load more deleted tasks"
            onClick={() => void loadMore()}
          >
            Load more
          </Button>
        </div>
      )}
    </section>
  );
}
