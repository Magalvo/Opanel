"use client";

import { formatPoints } from "@/components/task/task-meta";
import type { SprintProgress as Progress } from "@/lib/schemas/sprints";

function tasksDone({ doneTasks, totalTasks }: Progress): string {
  return `${String(doneTasks)} of ${String(totalTasks)} ${totalTasks === 1 ? "task" : "tasks"} done`;
}

/**
 * A sprint's progress (WS-144 sections 4 and 10): a bar of done over total tasks, named in
 * words, then the points as "12 / 30 points" and how many tasks have no estimate.
 */
export function SprintProgress({ progress }: Readonly<{ progress: Progress }>) {
  const { doneTasks, totalTasks, donePoints, totalPoints, unestimated } = progress;
  const name = tasksDone(progress);
  const percent = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100);
  return (
    <div className="grid gap-1.5">
      <div
        role="progressbar"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={totalTasks}
        aria-valuenow={doneTasks}
        className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${String(percent)}%` }} />
      </div>
      <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        <span>{name}</span>
        <span>{`${formatPoints(donePoints)} / ${formatPoints(totalPoints)} points`}</span>
        {unestimated > 0 && <span>{`${String(unestimated)} not estimated`}</span>}
      </p>
    </div>
  );
}
