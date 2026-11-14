import type { Actor } from "@/server/auth/actor";
import type { Database } from "@/server/db/client";
import { taskEvents } from "@/server/db/schema";

export type TaskEventType =
  "created" | "field_changed" | "moved" | "deleted" | "restored" | "commented";

export interface TaskEvent {
  taskId: string;
  /** Who acted. `null` means "no authenticated actor" and must be written out. */
  actor: Actor | null;
  type: TaskEventType;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Records one event of a task's history (canonical doc 0003 section 9, WS-030). Call it
 * with the transaction that makes the change, so the change and its event commit or roll
 * back together. The table is append-only.
 */
export async function recordTaskEvent(
  executor: Pick<Database, "insert">,
  event: TaskEvent,
): Promise<void> {
  await executor.insert(taskEvents).values({
    taskId: event.taskId,
    actorAccountId: event.actor?.accountId ?? null,
    type: event.type,
    field: event.field ?? null,
    oldValue: event.oldValue ?? null,
    newValue: event.newValue ?? null,
  });
}
