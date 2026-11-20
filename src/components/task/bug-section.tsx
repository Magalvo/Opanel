"use client";

import Link from "next/link";
import { useId } from "react";

import { taskHref } from "@/components/board/task-card";
import type { Page } from "@/lib/paged-list";
import type { BugReport } from "@/lib/schemas/task-bug-reports";
import type { Task, TaskLink } from "@/lib/schemas/tasks";

import { reportedText } from "./bug-labels";
import { ReportsSection } from "./reports-section";

const DIRECTIONS = [
  ["outgoing", "Regression of"],
  ["incoming", "Regressed by"],
] as const;

/** The task's links to other tasks, by direction (WS-091 section 4, question 7). */
function LinksSection({ links }: Readonly<{ links: readonly TaskLink[] }>) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-heading`} className="grid min-w-0 gap-2">
      <h3 id={`${id}-heading`} className="font-semibold">
        Links
      </h3>
      <dl className="grid min-w-0 gap-2 text-sm">
        {DIRECTIONS.map(([direction, label]) => {
          const shown = links.filter((link) => link.direction === direction);
          if (shown.length === 0) return null;
          return (
            <div key={direction} className="grid min-w-0 gap-1">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0">
                <ul className="grid gap-1">
                  {shown.map((link) => (
                    <li key={link.task.id} className="min-w-0">
                      <Link
                        href={taskHref(link.task.key)}
                        className="break-words underline-offset-4 hover:underline focus-visible:underline"
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          {link.task.key}
                        </span>{" "}
                        {link.task.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/**
 * What a bug adds to the detail (WS-091 section 4): how often it was reported, its links,
 * and the reports behind it. Nothing for a task never reported and without links.
 */
export function BugSection({
  task,
  reports,
}: Readonly<{ task: Task; reports: Page<BugReport> | null }>) {
  const reported = task.occurrences > 0;
  if (!reported && task.links.length === 0) return null;
  return (
    <div className="grid min-w-0 gap-5">
      {reported && (
        <p className="text-sm text-muted-foreground">
          {reportedText(task.occurrences, task.lastReportedAt)}
        </p>
      )}
      {task.links.length > 0 && <LinksSection links={task.links} />}
      {reported && (
        <ReportsSection
          taskKey={task.key}
          initial={reports}
          marker={`${String(task.occurrences)} ${task.lastReportedAt ?? ""}`}
        />
      )}
    </div>
  );
}
