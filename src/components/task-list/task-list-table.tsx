"use client";

import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import Link from "next/link";

import { taskHref, TYPE_LABELS } from "@/components/board/task-card";
import { relativeTime } from "@/components/task/activity-text";
import { isOverdue } from "@/components/task/due-date";
import { DueDateText, formatPoints, PRIORITY_LABELS } from "@/components/task/task-meta";
import type { TaskListItem, TaskSort, TaskSortField } from "@/lib/schemas/tasks";

// The table of the list view (WS-130 section 4): one row per task, the sortable headers
// each a button that sets the order; "Points" since WS-139, "Sprint" since WS-143.

interface ColumnSpec {
  name: string;
  sort?: TaskSortField;
  /** The order a first click gives: ascending, except Updated, newest first. */
  firstDescending?: boolean;
}

const COLUMNS: readonly ColumnSpec[] = [
  { name: "Key", sort: "key" },
  { name: "Title", sort: "title" },
  { name: "Type" },
  { name: "Status" },
  // Not sortable (WS-143 section 6, question 2).
  { name: "Sprint" },
  { name: "Priority", sort: "priority" },
  { name: "Assignee" },
  { name: "Due", sort: "dueDate" },
  { name: "Points", sort: "storyPoints" },
  { name: "Updated", sort: "updated", firstDescending: true },
];

function fieldOf(sort: TaskSort): { field: TaskSortField; descending: boolean } {
  return sort.startsWith("-")
    ? { field: sort.slice(1) as TaskSortField, descending: true }
    : { field: sort as TaskSortField, descending: false };
}

/** The order after a click on a header: reversed if it is the current one. */
function nextSort(current: TaskSort, column: ColumnSpec, sortField: TaskSortField): TaskSort {
  const { field, descending } = fieldOf(current);
  const toDescending = field === sortField ? !descending : (column.firstDescending ?? false);
  return toDescending ? `-${sortField}` : sortField;
}

function assigneeOf(item: TaskListItem): string {
  if (item.assignee !== null) {
    return item.assignee.active ? item.assignee.name : `${item.assignee.name} (inactive)`;
  }
  return item.assigneeTeam?.name ?? "Unassigned";
}

export function TaskListTable({
  items,
  sort,
  onSort,
  today,
  now,
}: Readonly<{
  items: readonly TaskListItem[];
  sort: TaskSort;
  onSort: (sort: TaskSort) => void;
  /** The viewer's today, `YYYY-MM-DD`, or `null` before it is known. */
  today: string | null;
  now: Date;
}>) {
  const current = fieldOf(sort);
  return (
    // The table scrolls inside its own box on a narrow screen, so the page never does.
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[62rem] text-sm">
        <caption className="sr-only">Tasks</caption>
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            {COLUMNS.map((column) => {
              const sortField = column.sort;
              const sorted = sortField !== undefined && sortField === current.field;
              const Arrow = current.descending ? ArrowDownIcon : ArrowUpIcon;
              return (
                <th
                  key={column.name}
                  scope="col"
                  className="px-3 py-2 font-medium whitespace-nowrap"
                  aria-sort={sorted ? (current.descending ? "descending" : "ascending") : undefined}
                >
                  {sortField === undefined ? (
                    column.name
                  ) : (
                    <button
                      type="button"
                      aria-label={`Sort by ${column.name}`}
                      className="inline-flex items-center gap-1 rounded-sm font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => {
                        onSort(nextSort(sort, column, sortField));
                      }}
                    >
                      {column.name}
                      {sorted && <Arrow aria-hidden="true" className="size-3" />}
                    </button>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const done = item.column?.category === "done";
            const updated = new Date(item.updatedAt);
            return (
              <tr key={item.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                  <Link
                    href={taskHref(item.key)}
                    className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {item.key}
                  </Link>
                </td>
                <td className="px-3 py-2 break-words">{item.title}</td>
                <td className="px-3 py-2 whitespace-nowrap">{TYPE_LABELS[item.type]}</td>
                <td className="px-3 py-2">{item.column?.name ?? "Backlog"}</td>
                <td className="px-3 py-2">{item.sprint?.name ?? ""}</td>
                <td className="px-3 py-2 whitespace-nowrap">{PRIORITY_LABELS[item.priority]}</td>
                <td className="px-3 py-2">{assigneeOf(item)}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <DueDateText
                    dueDate={item.dueDate}
                    overdue={isOverdue(item.dueDate, done, today)}
                  />
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                  {item.storyPoints === null ? "" : formatPoints(item.storyPoints)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <time dateTime={item.updatedAt} title={updated.toLocaleString()}>
                    {relativeTime(updated, now)}
                  </time>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
