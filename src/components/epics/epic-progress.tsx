import type { Epic } from "@/lib/schemas/epics";

/**
 * An epic's progress (WT-03 decision 18): a progress bar named "2 of 5 tasks done", with
 * "2 / 5" as text beside it so colour is never the only signal; "No tasks" without tasks.
 */
export function EpicProgress({ progress }: Readonly<{ progress: Epic["progress"] }>) {
  const { doneTasks, totalTasks } = progress;
  if (totalTasks === 0) {
    return <span className="text-sm text-muted-foreground">No tasks</span>;
  }
  return (
    <span className="inline-flex items-center gap-2">
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
    </span>
  );
}
