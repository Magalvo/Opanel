"use client";

import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import { NewTaskDialog } from "@/components/board/new-task-dialog";
import { taskHref } from "@/components/board/task-card";
import { Button } from "@/components/ui/button";
import type { Column } from "@/lib/schemas/columns";
import type { Task } from "@/lib/schemas/tasks";

/**
 * A task's sub-tasks (WS-135 section 2): each with its status and assignee, in the API's
 * order, how many are done, and "Add sub-task" for people who edit. Not shown on a
 * sub-task, which has none, nor to someone who cannot add one when there are none.
 */
export function SubtasksSection({
  task,
  columns,
  projectKey,
  editable,
  onCreated,
  onArchived,
}: Readonly<{
  task: Task;
  columns: readonly Column[];
  projectKey: string;
  editable: boolean;
  /** A sub-task was created: the page reads the task again. */
  onCreated: () => void;
  onArchived: () => void;
}>) {
  const id = useId();
  // The button that opened the dialog, which gets the focus back when it closes.
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const list = task.subtaskList;
  if (task.parent !== null) return null;
  if (!editable && list.length === 0) return null;

  // New sub-tasks go to the project's first column, as on the board (question 2).
  const first = columns[0] ?? null;
  const progress = task.subtasks;

  return (
    <section aria-labelledby={`${id}-heading`} className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-heading`} className="text-sm font-semibold">
          Sub-tasks
        </h3>
        {editable && (
          <Button
            variant="outline"
            size="sm"
            onClick={(event) => {
              setOpener(event.currentTarget);
            }}
          >
            <PlusIcon aria-hidden="true" />
            Add sub-task
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        {progress === null
          ? "No sub-tasks yet."
          : `${String(progress.done)} of ${String(progress.total)} done`}
      </p>
      {list.length > 0 && (
        <ul className="grid gap-1 text-sm">
          {list.map((subtask) => {
            const column = columns.find((item) => item.id === subtask.columnId);
            const status =
              subtask.columnId === null ? "Backlog" : (column?.name ?? "Unknown column");
            return (
              <li
                key={subtask.id}
                className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md border px-3 py-2"
              >
                <Link
                  href={taskHref(subtask.key)}
                  className="font-mono text-xs underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {subtask.key}
                </Link>
                <span className="min-w-0 flex-1 break-words">{subtask.title}</span>
                <span className="text-muted-foreground">{status}</span>
                <span className="text-muted-foreground">
                  {subtask.assignee?.name ?? "Unassigned"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {opener !== null && (
        <NewTaskDialog
          projectKey={projectKey}
          column={first}
          parent={{ id: task.id, key: task.key }}
          returnFocusTo={opener}
          onOpenChange={(open) => {
            if (!open) setOpener(null);
          }}
          onCreated={onCreated}
          onArchived={onArchived}
        />
      )}
    </section>
  );
}
