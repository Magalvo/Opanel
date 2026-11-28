"use client";

import { useId, useMemo, useState } from "react";

import type { Board } from "@/components/board/moves";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiFailure } from "@/lib/api-client";
import type { Column } from "@/lib/schemas/columns";
import type { CompletedSprint, Sprint } from "@/lib/schemas/sprints";

import { completeSprint } from "./api";
import { plannedSprintsOf } from "./sections";
import { SprintDialog } from "./sprint-dialog";

/** What a completion does to the board's tasks (WS-142 section 5). */
export interface CompletionCounts {
  /** Done tasks of done families: they stay as the sprint's record. */
  done: number;
  /** Every task of a family that is not done: they leave the board. */
  leaving: number;
  /** Unfinished sub-tasks of a done parent: they stay with it, in the record. */
  kept: number;
}

/**
 * Counts the board's tasks by family, as the API completes them: a family is a task with no
 * parent on the board, with its sub-tasks, and it is done when that task is in a `done`
 * column. A done family stays; any other leaves whole.
 */
export function completionCounts(board: Board, columns: readonly Column[]): CompletionCounts {
  const doneColumns = new Set(
    columns.filter((column) => column.category === "done").map((column) => column.id),
  );
  const tasks = Object.values(board).flat();
  const ids = new Set(tasks.map((task) => task.id));
  const headOf = (task: (typeof tasks)[number]) =>
    task.parent !== null && ids.has(task.parent.id) ? task.parent.id : task.id;
  const doneHeads = new Set(
    tasks
      .filter((task) => headOf(task) === task.id && doneColumns.has(task.columnId ?? ""))
      .map((task) => task.id),
  );
  const counts: CompletionCounts = { done: 0, leaving: 0, kept: 0 };
  for (const task of tasks) {
    if (!doneHeads.has(headOf(task))) counts.leaving++;
    else if (doneColumns.has(task.columnId ?? "")) counts.done++;
    else counts.kept++;
  }
  return counts;
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

function keptText(kept: number): string {
  return kept === 1
    ? "1 unfinished sub-task stays with its done parent"
    : `${String(kept)} unfinished sub-tasks stay with their done parent`;
}

/** "Sprint 4 completed: 8 done, 3 moved to Sprint 5." with the sub-tasks the record kept. */
export function completedText(
  sprint: CompletedSprint,
  counts: CompletionCounts,
  target: string,
): string {
  const moved = counts.leaving > 0 ? `, ${String(counts.leaving)} moved to ${target}` : "";
  const kept =
    sprint.unfinishedSubtasksKept > 0 ? ` ${keptText(sprint.unfinishedSubtasksKept)}.` : "";
  return `${sprint.name} completed: ${String(counts.done)} done${moved}.${kept}`;
}

const BACKLOG = "backlog";
const NEW = "new";

/**
 * "Complete Sprint 4?" (WS-144 section 8): counts, from the board it is given, the done tasks
 * that stay as the record, the unfinished ones that leave, and the unfinished sub-tasks kept
 * with a done parent; then chooses where the unfinished work goes: the next planned sprint
 * by default, else the backlog (question 4), or a new sprint made first.
 */
export function CompleteSprintDialog({
  projectKey,
  sprint,
  board,
  columns,
  planned,
  returnFocusTo,
  onOpenChange,
  onCompleted,
  onCreated,
  onNoLongerActive,
  onStale,
}: Readonly<{
  projectKey: string;
  sprint: Sprint;
  board: Board;
  columns: readonly Column[];
  planned: readonly Sprint[];
  returnFocusTo: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
  /** The sprint is completed: `message` says what happened. */
  onCompleted: (message: string) => void;
  /** A sprint was created with "New sprint…". */
  onCreated: (sprint: Sprint) => void;
  /** Someone else completed the sprint meanwhile. */
  onNoLongerActive: () => void;
  /** The sprint or the target changed meanwhile: the sprints are to be read again. */
  onStale: () => void;
}>) {
  const id = useId();
  const counts = useMemo(() => completionCounts(board, columns), [board, columns]);
  const [created, setCreated] = useState<Sprint[]>([]);
  const targets = useMemo(
    () =>
      plannedSprintsOf([
        ...planned,
        ...created.filter((item) => !planned.some((known) => known.id === item.id)),
      ]),
    [planned, created],
  );
  const [target, setTarget] = useState<string>(targets[0]?.id ?? BACKLOG);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const into = target === BACKLOG ? null : target;
    const name =
      into === null
        ? "the backlog"
        : (targets.find((item) => item.id === into)?.name ?? "the sprint");
    try {
      const answer = await completeSprint(sprint.id, {
        moveUnfinishedTo: into,
        version: sprint.version,
      });
      onCompleted(completedText(answer, counts, name));
      onOpenChange(false);
    } catch (failure) {
      const code = failure instanceof ApiFailure ? failure.code : null;
      if (code === "sprint_not_active") {
        onOpenChange(false);
        onNoLongerActive();
        return;
      }
      if (code === "version_conflict") {
        setError(`Someone else changed ${sprint.name}. Try again.`);
        onStale();
      } else if (failure instanceof ApiFailure && failure.status === 400) {
        setError("That sprint can no longer take the work. Choose another place.");
        onStale();
      } else if (code === "project_archived") {
        setError("The project is archived.");
      } else {
        setError(`Could not complete ${sprint.name}. Try again.`);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Dialog open={!creating} onOpenChange={onOpenChange}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // Hidden for "New sprint…": the sprint dialog takes the focus.
            if (!creating) returnFocusTo?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{`Complete ${sprint.name}?`}</DialogTitle>
            <DialogDescription>
              Its progress is kept as it is now, as the sprint&apos;s record.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => void submit(event)} className="grid gap-4" noValidate>
            <ul className="grid list-disc gap-1 pl-5 text-sm">
              <li>
                {`${plural(counts.done, "done task stays", "done tasks stay")} as the sprint's record.`}
              </li>
              <li>
                {`${plural(counts.leaving, "unfinished task leaves", "unfinished tasks leave")} the board.`}
              </li>
              {counts.kept > 0 && <li>{`${keptText(counts.kept)}, as part of the record.`}</li>}
            </ul>
            <div className="grid gap-1.5">
              <label htmlFor={`${id}-target`} className="text-sm font-medium">
                Move the unfinished work to
              </label>
              <select
                id={`${id}-target`}
                value={target}
                onChange={(event) => {
                  if (event.target.value === NEW) {
                    setCreating(true);
                    return;
                  }
                  setTarget(event.target.value);
                }}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
              >
                {targets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
                <option value={BACKLOG}>Backlog (unscheduled)</option>
                <option value={NEW}>New sprint…</option>
              </select>
            </div>
            {error !== null && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                Complete sprint
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {creating && (
        <SprintDialog
          projectKey={projectKey}
          sprint={null}
          returnFocusTo={null}
          onOpenChange={(open) => {
            if (!open) setCreating(false);
          }}
          onSaved={(saved) => {
            setCreated((current) => [...current, saved]);
            setTarget(saved.id);
            onCreated(saved);
          }}
        />
      )}
    </>
  );
}
