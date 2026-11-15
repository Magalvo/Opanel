import type { Column } from "@/lib/schemas/columns";
import type { TaskSummary } from "@/lib/schemas/tasks";

import { column, PROJECT_ID } from "../projects/test-support";

export const TODO = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
export const DOING = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
export const DONE = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";

export const columns: Column[] = [
  column(TODO, "To do", "todo"),
  column(DOING, "In progress", "in_progress"),
  column(DONE, "Done", "done"),
];

const MIA = { id: "11111111-1111-4111-8111-111111111111", name: "Mia", active: true };

let counter = 0;

/** A task as the list returns it. `key` decides its id, so a test can name it. */
export function task(
  key: string,
  title: string,
  columnId: string,
  overrides: Partial<TaskSummary> = {},
): TaskSummary {
  counter += 1;
  const number = Number(key.split("-")[1]);
  return {
    id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    key,
    number,
    projectId: PROJECT_ID,
    type: "task",
    title,
    columnId,
    assigneeTeam: null,
    assignee: null,
    epic: null,
    reporter: { id: MIA.id, name: MIA.name },
    version: 1,
    createdAt: `2026-11-12T10:00:0${String(counter % 10)}.000Z`,
    updatedAt: "2026-11-12T10:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

/** What the move and create endpoints answer: the task, with its description. */
export function fullTask(summary: TaskSummary, overrides: Partial<TaskSummary> = {}) {
  return { ...summary, description: "", ...overrides };
}

export const t1 = task("OPA-1", "Fix login", TODO);
export const t2 = task("OPA-2", "Write docs", TODO, { type: "bug" });
export const t3 = task("OPA-3", "Review", DOING, {
  assignee: MIA,
  assigneeTeam: { id: "22222222-2222-4222-8222-222222222222", name: "Platform" },
  epic: { id: "33333333-3333-4333-8333-333333333333", title: "Auth" },
});
export const t4 = task("OPA-4", "Ship it", DONE, { type: "story" });
