// Test data shared by the sprint UI's tests (WS-144).
import { PROJECT_ID, task } from "@/components/board/test-data";
import type { Sprint, SprintProgress, SprintState } from "@/lib/schemas/sprints";
import type { TaskSummary } from "@/lib/schemas/tasks";

export const NO_PROGRESS: SprintProgress = {
  doneTasks: 0,
  totalTasks: 0,
  donePoints: 0,
  totalPoints: 0,
  unestimated: 0,
};

/** A sprint of OPA, numbered so each has its own id. */
export function sprint(
  number: number,
  state: SprintState,
  startDate: string,
  endDate: string,
  extra: Partial<Sprint> = {},
): Sprint {
  return {
    id: `cccccccc-cccc-4ccc-8ccc-${String(number).padStart(12, "0")}`,
    projectId: PROJECT_ID,
    name: `Sprint ${String(number)}`,
    goal: "",
    startDate,
    endDate,
    state,
    startedAt: state === "planned" ? null : `${startDate}T09:00:00.000Z`,
    completedAt: state === "completed" ? `${endDate}T17:00:00.000Z` : null,
    progress: NO_PROGRESS,
    version: 1,
    createdAt: "2026-11-20T10:00:00.000Z",
    updatedAt: "2026-11-20T10:00:00.000Z",
    ...extra,
  };
}

/** A task as a task shows its sprint. */
export function refOf({ id, name, state }: Sprint) {
  return { id, name, state };
}

/** A backlog task (no column), in `sprint` or unscheduled. */
export function inBacklog(
  number: number,
  of: Sprint | null,
  extra: Partial<TaskSummary> = {},
): TaskSummary {
  return task(number, "", { columnId: null, sprint: of === null ? null : refOf(of), ...extra });
}

export const OPEN_SPRINTS = "GET /api/v1/projects/OPA/sprints?limit=100&state=active&state=planned";
export const ALL_SPRINTS = "GET /api/v1/projects/OPA/sprints?limit=100";
export const COMPLETED_SPRINTS = "GET /api/v1/projects/OPA/sprints?limit=100&state=completed";
export const BACKLOG = "GET /api/v1/projects/OPA/backlog?limit=100";

/** A `sprint.changed` event, as the stream sends it. */
export function sprintChanged(sprintId: string, version: number | null) {
  return {
    id: crypto.randomUUID(),
    type: "sprint.changed",
    projectId: PROJECT_ID,
    entity: "sprint",
    entityId: sprintId,
    version,
    actorAccountId: "55555555-5555-4555-8555-555555555555",
    at: "2026-12-05T10:00:00.000Z",
  };
}
