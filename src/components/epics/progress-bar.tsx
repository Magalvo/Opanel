/**
 * An epic's progress: done tasks over all of its tasks (WT-03 decision 18). A progress bar for
 * assistive technology, and the numbers as text, so colour is never the only signal.
 */
export function ProgressBar({
  title,
  doneTasks,
  totalTasks,
}: Readonly<{ title: string; doneTasks: number; totalTasks: number }>) {
  if (totalTasks === 0) {
    return <span className="text-sm text-muted-foreground">No tasks</span>;
  }
  const percent = Math.round((doneTasks / totalTasks) * 100);

  return (
    <div className="flex items-center gap-2">
      <div
        role="progressbar"
        aria-label={`Progress of ${title}: ${String(doneTasks)} of ${String(totalTasks)} tasks done`}
        aria-valuemin={0}
        aria-valuemax={totalTasks}
        aria-valuenow={doneTasks}
        className="h-2 w-24 overflow-hidden rounded-full bg-muted"
      >
        <div
          data-testid="progress-fill"
          className="h-full bg-primary"
          style={{ width: `${String(percent)}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{`${String(doneTasks)} / ${String(totalTasks)}`}</span>
    </div>
  );
}
