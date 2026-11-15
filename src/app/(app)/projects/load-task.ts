import { notFound } from "next/navigation";

import { type Actor, can, canDeleteTask } from "@/server/auth/actor";
import { ApiError } from "@/server/http/errors";
import { getTask } from "@/server/services/tasks";

import { loadProject } from "./load-project";

const TASK_KEY = /^[A-Z][A-Z0-9]{1,9}-[1-9]\d*$/;

/**
 * The task a page is about, with what the actor may do with it (WS-038). A key of another
 * project, an unknown key and a deleted task are all the not-found page.
 */
export async function loadTask(actor: Actor, projectKey: string, taskKey: string) {
  if (!TASK_KEY.test(taskKey)) {
    notFound();
  }
  const project = await loadProject(actor, projectKey);
  try {
    const task = await getTask(actor, taskKey);
    if (task.projectId !== project.id) {
      notFound();
    }
    return {
      task,
      archived: project.archivedAt !== null,
      canWrite: can(actor, "tasks:write"),
      canDelete: canDeleteTask(actor, { reporterId: task.reporter.id }),
      canComment: can(actor, "comments:write"),
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }
}
