// The filter of a task page, as its URL holds it (WS-120 section 2): the API's parameter
// names and raw values, each checked with the API's own schema, so a link that works for
// the API works for the page and the other way round.
import type { z } from "zod";

import { TYPE_LABELS } from "@/components/board/task-card";
import { SEVERITY_LABELS } from "@/components/task/bug-labels";
import { formatDueDate } from "@/components/task/due-date";
import { PRIORITY_LABELS } from "@/components/task/task-meta";
import type { Priority, TaskSort, TaskType } from "@/lib/schemas/tasks";
import { allTasksQuerySchema, taskListQuerySchema, taskSortSchema } from "@/lib/schemas/tasks";

/** Every filter parameter, in the order a link writes them. */
export const FILTER_KEYS = [
  "projectId",
  "q",
  "type",
  "category",
  "done",
  "columnId",
  "assigneeTeamId",
  "assigneeAccountId",
  "reporterAccountId",
  "reporterKind",
  "labelId",
  "epicId",
  "sprintId",
  "priority",
  "severity",
  "dueFrom",
  "dueTo",
] as const;

export type FilterKey = (typeof FILTER_KEYS)[number];

/**
 * The board takes every filter of one project; the backlog has no column; the list across
 * projects (WS-130) has projects and no column.
 */
export const BOARD_KEYS: readonly FilterKey[] = FILTER_KEYS.filter((key) => key !== "projectId");
export const BACKLOG_KEYS: readonly FilterKey[] = BOARD_KEYS.filter((key) => key !== "columnId");
export const LIST_KEYS: readonly FilterKey[] = FILTER_KEYS.filter((key) => key !== "columnId");

/** Raw values by parameter; an absent or empty list is no filter. */
export type TaskFilter = Partial<Record<FilterKey, readonly string[]>>;

// Each parameter's own schema: the project lists', and the list across projects' `projectId`.
const SHAPE = {
  ...taskListQuerySchema.shape,
  projectId: allTasksQuerySchema.shape.projectId,
} as unknown as Record<FilterKey, z.ZodType>;

/**
 * The filter in `params`, one parameter at a time: one the API would refuse is dropped and
 * named in `ignored`, and the others still apply (WS-120 section 2).
 */
export function readFilter(
  params: URLSearchParams,
  keys: readonly FilterKey[],
): { filter: TaskFilter; ignored: FilterKey[] } {
  const filter: Record<string, readonly string[]> = {};
  const ignored: FilterKey[] = [];
  for (const key of FILTER_KEYS) {
    const values = params.getAll(key);
    if (values.length === 0) continue;
    const parsed = SHAPE[key].safeParse(values.length === 1 ? values[0] : values);
    if (!keys.includes(key) || !parsed.success) {
      ignored.push(key);
      continue;
    }
    filter[key] = key === "q" ? [String(parsed.data)] : values;
  }
  const from = filter.dueFrom?.[0];
  const to = filter.dueTo?.[0];
  if (from !== undefined && to !== undefined && from > to) {
    delete filter.dueTo;
    ignored.push("dueTo");
  }
  return { filter, ignored };
}

/** The query string of a filter, without `?`, in a fixed order. */
export function writeFilter(filter: TaskFilter): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    for (const value of filter[key] ?? []) params.append(key, value);
  }
  return params.toString();
}

/** The filter for an API call: `&` and the query string, or nothing. */
export function filterQuery(filter: TaskFilter): string {
  const query = writeFilter(filter);
  return query === "" ? "" : `&${query}`;
}

/** The list's default order (WT-08 decision 4), which a link leaves out. */
export const DEFAULT_SORT: TaskSort = "-updated";

/** The order in `params`; an absent one, or one the API would refuse, is the default. */
export function readSort(params: URLSearchParams): { sort: TaskSort; ignored: boolean } {
  const value = params.get("sort");
  if (value === null) return { sort: DEFAULT_SORT, ignored: false };
  const parsed = taskSortSchema.safeParse(value);
  return parsed.success
    ? { sort: parsed.data, ignored: false }
    : { sort: DEFAULT_SORT, ignored: true };
}

/** The order's query string, without `?`: nothing for the default. */
export function writeSort(sort: TaskSort): string {
  return sort === DEFAULT_SORT ? "" : `sort=${sort}`;
}

export function isEmpty(filter: TaskFilter): boolean {
  return FILTER_KEYS.every((key) => (filter[key] ?? []).length === 0);
}

function withList(filter: TaskFilter, key: FilterKey, values: readonly string[]): TaskFilter {
  const others = Object.entries(filter).filter(([name]) => name !== key);
  return Object.fromEntries(values.length === 0 ? others : [...others, [key, values]]);
}

export function withValue(filter: TaskFilter, key: FilterKey, value: string): TaskFilter {
  const values = filter[key] ?? [];
  return values.includes(value) ? filter : withList(filter, key, [...values, value]);
}

export function withoutValue(filter: TaskFilter, key: FilterKey, value: string): TaskFilter {
  return withList(
    filter,
    key,
    (filter[key] ?? []).filter((item) => item !== value),
  );
}

/** A parameter holding exactly these values, or none. */
export function withValues(
  filter: TaskFilter,
  key: FilterKey,
  values: readonly string[],
): TaskFilter {
  return withList(filter, key, values);
}

/** Names for the ids a filter holds, as far as the page knows them. */
export interface FilterNames {
  /** A project's key by its id. */
  projects?: ReadonlyMap<string, string>;
  labels?: ReadonlyMap<string, string>;
  epics?: ReadonlyMap<string, string>;
  sprints?: ReadonlyMap<string, string>;
  teams?: ReadonlyMap<string, string>;
  people?: ReadonlyMap<string, string>;
  columns?: ReadonlyMap<string, string>;
}

export interface FilterChip {
  key: FilterKey;
  value: string;
  label: string;
  /** The filter without this value. */
  without: TaskFilter;
}

const CATEGORY_LABELS: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

function named(
  names: ReadonlyMap<string, string> | undefined,
  id: string,
  unknown: string,
): string {
  return names?.get(id) ?? unknown;
}

function chipLabel(key: FilterKey, value: string, names: FilterNames): string {
  switch (key) {
    case "projectId":
      return `Project: ${names.projects?.get(value) ?? value}`;
    case "q":
      return `Search: ${value}`;
    case "type":
      return `Type: ${TYPE_LABELS[value as TaskType]}`;
    case "category":
      return `Column category: ${CATEGORY_LABELS[value] ?? value}`;
    case "done":
      return value === "true" ? "Done" : "Not done";
    case "columnId":
      return `Column: ${value === "backlog" ? "Backlog" : named(names.columns, value, "an unknown column")}`;
    case "assigneeTeamId":
      return `Team: ${value === "none" ? "No team" : named(names.teams, value, "an unknown team")}`;
    case "assigneeAccountId":
      return `Assignee: ${
        value === "me"
          ? "Me"
          : value === "none"
            ? "Unassigned"
            : named(names.people, value, "an unknown person")
      }`;
    case "reporterAccountId":
      return `Reporter: ${value === "me" ? "Me" : named(names.people, value, "an unknown person")}`;
    case "reporterKind":
      return `Reporter: ${value === "agent" ? "Agents" : "People"}`;
    case "labelId":
      return `Label: ${named(names.labels, value, "an unknown label")}`;
    case "epicId":
      return `Epic: ${value === "none" ? "No epic" : named(names.epics, value, "an unknown epic")}`;
    case "sprintId":
      return `Sprint: ${
        value === "active"
          ? "Active sprint"
          : value === "none"
            ? "No sprint"
            : named(names.sprints, value, "an unknown sprint")
      }`;
    case "priority":
      return `Priority: ${PRIORITY_LABELS[value as Priority]}`;
    case "severity":
      return `Severity: ${SEVERITY_LABELS[value as keyof typeof SEVERITY_LABELS]}`;
    case "dueFrom":
      return `Due from ${formatDueDate(value)}`;
    case "dueTo":
      return `Due by ${formatDueDate(value)}`;
  }
}

/** One chip per value, in the order of the link (WS-120 section 3). */
export function chipsOf(filter: TaskFilter, names: FilterNames): FilterChip[] {
  return FILTER_KEYS.flatMap((key) =>
    (filter[key] ?? []).map((value) => ({
      key,
      value,
      label: chipLabel(key, value, names),
      without: withoutValue(filter, key, value),
    })),
  );
}

/**
 * Where a moved item goes in the full list, from its index in the shown list once moved
 * (WS-120 section 4): right after the shown item above it, or right before the shown item
 * below it, or at the end. The index is the item's own once moved, as a drop takes it.
 */
export function fullIndex(
  full: readonly { id: string }[],
  shown: readonly { id: string }[],
  id: string,
  shownIndex: number,
): number {
  const rest = shown.filter((item) => item.id !== id);
  const above = rest[shownIndex - 1];
  const below = rest[shownIndex];
  const others = full.filter((item) => item.id !== id);
  if (above !== undefined) {
    const at = others.findIndex((item) => item.id === above.id);
    if (at !== -1) return at + 1;
  }
  if (below !== undefined) {
    const at = others.findIndex((item) => item.id === below.id);
    if (at !== -1) return at;
  }
  return others.length;
}
