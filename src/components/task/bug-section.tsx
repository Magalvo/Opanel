"use client";

import type { Page } from "@/lib/paged-list";
import type { BugReport } from "@/lib/schemas/task-bug-reports";
import type { Task } from "@/lib/schemas/tasks";

import { reportedText } from "./bug-labels";
import { ReportsSection } from "./reports-section";

/**
 * What a bug adds to the detail (WS-091 section 4): how often it was reported, and the
 * reports behind it. Nothing for a task never reported. Its regression links are in the
 * "Links" section, with every other link (WS-136 section 6).
 */
export function BugSection({
  task,
  reports,
}: Readonly<{ task: Task; reports: Page<BugReport> | null }>) {
  if (task.occurrences === 0) return null;
  return (
    <div className="grid min-w-0 gap-5">
      <p className="text-sm text-muted-foreground">
        {reportedText(task.occurrences, task.lastReportedAt)}
      </p>
      <ReportsSection
        taskKey={task.key}
        initial={reports}
        marker={`${String(task.occurrences)} ${task.lastReportedAt ?? ""}`}
      />
    </div>
  );
}
