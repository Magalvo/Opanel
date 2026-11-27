import { formatPoints } from "@/components/task/task-meta";
import type { Epic } from "@/lib/schemas/epics";

/**
 * An epic's progress (WT-03 decision 18): a progress bar named "2 of 5 tasks done", with
 * "2 / 5" as text beside it so colour is never the only signal; "No tasks" without tasks.
 * Beside it, the story points done of all, and how many tasks have none (WS-139 section 6);
 * no points text for an epic whose tasks have no points.
 */
export function EpicProgress({ progress }: Readonly<{ progress: Epic["progress"] }>) {
  const { doneTasks, totalTasks, donePoints, totalPoints, unestimated } = progress;
  if (totalTasks === 0) {
    return <span className="text-sm text-muted-foreground">No tasks</span>;
  }
  const estimated = unestimated < totalTasks;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={totalTasks}
        aria-valuenow={doneTasks}
        aria-label={`${String(doneTasks)} of ${String(totalTasks)} tasks done`}
        className="h-2 w-20 overflow-hidden rounded-full bg-muted"
      >
        <span
          className="block h-full rounded-full bg-primary"
          style={{ width: `${String((doneTasks / totalTasks) * 100)}%` }}
        />
      </span>
      <span className="text-sm tabular-nums">
        {doneTasks} / {totalTasks}
      </span>
      {estimated && (
        <span
          role="img"
          aria-label={`${formatPoints(donePoints)} of ${formatPoints(totalPoints)} story points done`}
          className="text-sm text-muted-foreground tabular-nums"
        >
          <span aria-hidden="true">{`${formatPoints(donePoints)} / ${formatPoints(totalPoints)} points`}</span>
        </span>
      )}
      {estimated && unestimated > 0 && (
        <span className="text-sm text-muted-foreground">{unestimated} not estimated</span>
      )}
    </span>
  );
}
