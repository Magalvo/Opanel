// The bridge between the task detail and the board behind it (WS-038 section 4): two window
// events carrying what the API returned. They stay with live updates (WT-04 decision 9,
// WS-048): they show a save in the same tab at once, and the event that follows it through
// the stream carries the same version, so the board ignores it.
import { z } from "zod";

import { type Task, taskSchema } from "@/lib/schemas/tasks";

export const TASK_CHANGED = "opanel:task-changed";
export const TASK_DELETED = "opanel:task-deleted";

const deletedSchema = z.strictObject({ id: z.uuid() });

/** After a save or a move: the task as the API returned it. */
export function announceTaskChanged(task: Task): void {
  window.dispatchEvent(new CustomEvent(TASK_CHANGED, { detail: task }));
}

/** After a delete. */
export function announceTaskDeleted(id: string): void {
  window.dispatchEvent(new CustomEvent(TASK_DELETED, { detail: { id } }));
}

function detailOf(event: Event): unknown {
  return event instanceof CustomEvent ? (event.detail as unknown) : null;
}

/** Listens to both events; a malformed event is ignored. Returns the unsubscribe function. */
export function onTaskEvents(handlers: {
  changed: (task: Task) => void;
  deleted: (id: string) => void;
}): () => void {
  function changed(event: Event) {
    const task = taskSchema.safeParse(detailOf(event));
    if (task.success) handlers.changed(task.data);
  }
  function deleted(event: Event) {
    const detail = deletedSchema.safeParse(detailOf(event));
    if (detail.success) handlers.deleted(detail.data.id);
  }
  window.addEventListener(TASK_CHANGED, changed);
  window.addEventListener(TASK_DELETED, deleted);
  return () => {
    window.removeEventListener(TASK_CHANGED, changed);
    window.removeEventListener(TASK_DELETED, deleted);
  };
}
