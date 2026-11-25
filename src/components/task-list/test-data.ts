// Items of the list across projects (WS-130), for the list view's tests.
import { doing, done, opa, task, todo } from "@/components/board/test-data";
import type { Column } from "@/lib/schemas/projects";
import type { TaskListItem, TaskSummary } from "@/lib/schemas/tasks";

export const OPS_ID = "1f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

export const ops = { ...opa, id: OPS_ID, key: "OPS", name: "Operations" };

function columnOf(column: Column) {
  return { id: column.id, name: column.name, category: column.category };
}

/** A task of OPA (or of `project`), in `column`, or in the backlog for `null`. */
export function item(
  number: number,
  column: Column | null,
  extra: Partial<TaskSummary> = {},
  project: { id: string; key: string; name: string } = opa,
): TaskListItem {
  const summary = task(number, column?.id ?? "", extra);
  return {
    ...summary,
    id:
      project.key === "OPA"
        ? summary.id
        : `cccccccc-cccc-4ccc-8ccc-${String(number).padStart(12, "0")}`,
    key: `${project.key}-${String(number)}`,
    projectId: project.id,
    columnId: column?.id ?? null,
    project: { id: project.id, key: project.key, name: project.name },
    column: column === null ? null : columnOf(column),
  };
}

export { doing, done, todo };

/** The first page's request: 50 rows, the order, then the filter (WS-130 section 4). */
export function listUrl(sort = "-updated", filter = "", cursor?: string): string {
  return (
    `GET /api/v1/tasks?limit=50&sort=${sort}${filter === "" ? "" : `&${filter}`}` +
    (cursor === undefined ? "" : `&cursor=${cursor}`)
  );
}

export const PROJECTS = "GET /api/v1/projects?limit=50";
