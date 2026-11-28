// The backlog of a project with sprints (WS-144 sections 4 and 5): its one ranking grouped
// into a section per planned sprint and one of unscheduled tasks, and the move a drop or a
// menu makes between them. The sections are held as a board whose columns are sections, so
// the board's drop, anchor and collision rules apply as they are. No React here.
import {
  applyDrop,
  type Board,
  columnDroppableId,
  moveRequest,
  type Place,
  placeOf,
  targetOf,
} from "@/components/board/moves";
import type { Sprint } from "@/lib/schemas/sprints";
import type { MoveTaskRequest, TaskSummary } from "@/lib/schemas/tasks";

import { SUBTASK_STAYS } from "./messages";

/** The section of the unscheduled tasks; never a sprint's uuid. */
export const UNSCHEDULED = "unscheduled";

/** Each section's tasks in backlog order, keyed by sprint id or `UNSCHEDULED`, in order. */
export type Sections = Board;

/** The drop-target id of a section itself, as a column's is on the board. */
export const sectionDroppableId = columnDroppableId;

function byStart(a: Sprint, b: Sprint): number {
  if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/** The planned sprints, by start date. */
export function plannedSprintsOf(sprints: readonly Sprint[]): Sprint[] {
  return sprints.filter((item) => item.state === "planned").sort(byStart);
}

/** The active sprint, or `null`. */
export function activeSprintOf(sprints: readonly Sprint[]): Sprint | null {
  return sprints.find((item) => item.state === "active") ?? null;
}

/** The section a backlog task is in: its planned sprint's, else the unscheduled one. */
export function sectionOf(task: TaskSummary, planned: readonly Sprint[]): string {
  const id = task.sprint?.id;
  return id !== undefined && planned.some((item) => item.id === id) ? id : UNSCHEDULED;
}

/** The ranking grouped into sections: the planned sprints in order, then the unscheduled. */
export function groupSections(tasks: readonly TaskSummary[], planned: readonly Sprint[]): Sections {
  const sections: Record<string, TaskSummary[]> = {};
  for (const item of planned) sections[item.id] = [];
  sections[UNSCHEDULED] = [];
  for (const task of tasks) sections[sectionOf(task, planned)]?.push(task);
  return sections;
}

/** A section's name, as a menu and an announcement say it. */
export function sectionName(sectionId: string, planned: readonly Sprint[]): string {
  if (sectionId === UNSCHEDULED) return "Backlog";
  return planned.find((item) => item.id === sectionId)?.name ?? "a sprint";
}

/** The place a drop target stands for: a row's own place, or the end of a section. */
export function sectionTarget(sections: Sections, overId: string): Place | null {
  return targetOf(sections, overId);
}

/** The sections after moving a task to `index` of a section, with its sprint set to it. */
export function dropInSection(
  sections: Sections,
  planned: readonly Sprint[],
  taskId: string,
  sectionId: string,
  index: number,
): Sections {
  const after = applyDrop(sections, taskId, sectionId, index);
  if (after === sections) return sections;
  const sprint = sprintRefOf(sectionId, planned);
  return {
    ...after,
    [sectionId]: (after[sectionId] ?? []).map((item) =>
      item.id === taskId ? { ...item, columnId: null, sprint } : item,
    ),
  };
}

function sprintRefOf(sectionId: string, planned: readonly Sprint[]): TaskSummary["sprint"] {
  const found = planned.find((item) => item.id === sectionId);
  return found === undefined ? null : { id: found.id, name: found.name, state: found.state };
}

/**
 * "Sprint 4, position 2 of 5": where a task is, or where it would be at `to`.
 */
export function positionText(
  sections: Sections,
  planned: readonly Sprint[],
  taskId: string,
  to?: Place | null,
): string {
  const shown =
    to === undefined || to === null
      ? sections
      : dropInSection(sections, planned, taskId, to.columnId, to.index);
  const place = placeOf(shown, taskId);
  if (place === null) return "";
  const total = shown[place.columnId]?.length ?? 0;
  return `${sectionName(place.columnId, planned)}, position ${String(place.index + 1)} of ${String(total)}`;
}

/**
 * A move of a task to `index` of a section (WS-141 section 5): the ranking as it is once
 * moved, and the one request that makes it, `columnId: null` with the section's sprint
 * (`null` for the unscheduled one) and the task next to it as the anchor. `null` when the
 * task stays where it is or is unknown.
 */
export function sectionMove(
  tasks: readonly TaskSummary[],
  planned: readonly Sprint[],
  taskId: string,
  sectionId: string,
  index: number,
): { after: TaskSummary[]; request: MoveTaskRequest } | null {
  const before = groupSections(tasks, planned);
  const moved = dropInSection(before, planned, taskId, sectionId, index);
  const anchors = moveRequest(before, moved, taskId);
  const task = moved[sectionId]?.find((item) => item.id === taskId);
  if (anchors === null || task === undefined) return null;

  const { columnId: _section, ...anchor } = anchors;
  const request: MoveTaskRequest = {
    columnId: null,
    sprintId: sectionId === UNSCHEDULED ? null : sectionId,
    ...anchor,
  };
  // In the one ranking: right after the task above, right before the task below, or at the
  // end of the backlog when the section was empty, as the API places it.
  const rest = tasks.filter((item) => item.id !== taskId);
  const at =
    anchor.afterTaskId !== undefined
      ? rest.findIndex((item) => item.id === anchor.afterTaskId) + 1
      : anchor.beforeTaskId !== undefined
        ? rest.findIndex((item) => item.id === anchor.beforeTaskId)
        : rest.length;
  rest.splice(at, 0, task);
  return { after: rest, request };
}

/**
 * Why a drop is refused before any request (section 5): a sub-task's sprint is its
 * parent's, so it moves only within its section. `null` when the drop may be sent.
 */
export function dropRefusal(task: TaskSummary, from: string, to: string): string | null {
  return task.parent !== null && from !== to ? SUBTASK_STAYS : null;
}

/** One item of a row's "Move to" menu: a place in a section, or the active sprint (`null`). */
export interface RowMove {
  label: string;
  sectionId: string | null;
  index: number;
  disabled: boolean;
}

/**
 * A row's "Move to" menu (section 5): the top and bottom of its section, then each other
 * planned sprint's end, the end of the backlog, and the active sprint while one is active.
 * A sub-task only moves within its section.
 */
export function rowMoves(
  sections: Sections,
  planned: readonly Sprint[],
  taskId: string,
  hasActive: boolean,
): RowMove[] {
  const from = placeOf(sections, taskId);
  if (from === null) return [];
  const { columnId: sectionId, index } = from;
  const last = (sections[sectionId]?.length ?? 1) - 1;
  const within: RowMove[] = [
    { label: "Move to top", sectionId, index: 0, disabled: index === 0 },
    { label: "Move to bottom", sectionId, index: last, disabled: index === last },
  ];
  const task = sections[sectionId]?.[index];
  if (task?.parent !== null) return within;
  const others: RowMove[] = Object.keys(sections)
    .filter((id) => id !== sectionId)
    .map((id) => ({
      label: sectionName(id, planned),
      sectionId: id,
      index: sections[id]?.length ?? 0,
      disabled: false,
    }));
  const active: RowMove[] = hasActive
    ? [{ label: "Active sprint", sectionId: null, index: 0, disabled: false }]
    : [];
  return [...within, ...others, ...active];
}
