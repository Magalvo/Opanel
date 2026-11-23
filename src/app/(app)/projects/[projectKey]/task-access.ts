import { notFound } from "next/navigation";

import { taskKeySchema } from "@/lib/schemas/tasks";
import { can } from "@/server/auth/actor";
import { requireAccount } from "@/server/auth/session";

/** What the task detail needs from the server (WS-038 section 1). */
export interface TaskAccess {
  taskKey: string;
  canWriteTasks: boolean;
  /** Applying labels and creating them (WS-108). */
  canWriteLabels: boolean;
  canComment: boolean;
  canDeleteAny: boolean;
  canDeleteOwn: boolean;
  accountId: string;
}

/**
 * Checks the session, and that the segment is a task key of the URL's project; anything
 * else is a plain not-found page. The task itself is read by the browser through the API,
 * which stays the guard.
 */
export async function taskAccess(
  params: Promise<{ projectKey: string; taskKey: string }>,
): Promise<TaskAccess> {
  const { actor } = await requireAccount();
  const { projectKey, taskKey } = await params;
  const parsed = taskKeySchema.safeParse(taskKey);
  if (!parsed.success || parsed.data.slice(0, parsed.data.lastIndexOf("-")) !== projectKey) {
    notFound();
  }
  return {
    taskKey: parsed.data,
    canWriteTasks: can(actor, "tasks:write"),
    canWriteLabels: can(actor, "labels:write"),
    canComment: can(actor, "comments:write"),
    canDeleteAny: can(actor, "tasks:delete_any"),
    canDeleteOwn: can(actor, "tasks:delete_own"),
    accountId: actor.accountId,
  };
}
