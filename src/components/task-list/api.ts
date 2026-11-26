import { listProjects } from "@/components/projects/api";
import { call } from "@/lib/api-client";
import type { Project } from "@/lib/schemas/projects";
import { taskListItemPageSchema, type TaskSort } from "@/lib/schemas/tasks";

import { filterQuery, type TaskFilter } from "../filters/task-filter";

// The list across projects (WS-118) as the list view calls it (WS-130 section 5). Named
// apart from the board's `listAllTasks`, which reads one project's board.

/** How many rows a page of the list holds. */
export const LIST_PAGE_SIZE = 50;

/** One page of `GET /api/v1/tasks`: the order, then the filter, then the cursor. */
export function listTaskItems(sort: TaskSort, filter: TaskFilter, cursor?: string) {
  const after = cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`;
  return call(
    `/api/v1/tasks?limit=${String(LIST_PAGE_SIZE)}&sort=${sort}${filterQuery(filter)}${after}`,
    {},
    taskListItemPageSchema,
  );
}

/** Every project that is not archived, for the Project menu. */
export async function listOpenProjects(): Promise<Project[]> {
  const projects: Project[] = [];
  let cursor: string | undefined;
  do {
    const page = await listProjects(false, cursor);
    projects.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return projects;
}
