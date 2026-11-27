import { z } from "zod";

import { LINK_READINGS, taskLinkRequestSchema } from "@/lib/schemas/task-links";
import { type Task, taskRefSchema, taskSchema } from "@/lib/schemas/tasks";

import { messageError, toolError } from "../errors";
import type { ToolDefinition } from "../tools";
import {
  CHANGES_OPANEL,
  DATA_NOT_INSTRUCTIONS,
  query,
  readResult,
  REPLACING_WRITE,
  WRITE,
} from "./results";

// `opanel_add_link` and `opanel_remove_link`: links between tasks (doc 0005 section 4,
// WS-137 sections 2 and 3).

const { type, direction } = taskLinkRequestSchema.shape;

// `otherTaskId`, not the API's `taskId`, so `taskId` always names the task acted on
// (WS-137 question 1).
const inputSchema = z.strictObject({
  taskId: taskRefSchema,
  type,
  direction,
  otherTaskId: taskRefSchema,
});

type LinkInput = z.infer<typeof inputSchema>;

const PERMISSIONS = ["tasks:write", "tasks:read"] as const;

const ABOUT =
  "type is blocks, duplicates, regression_of or relates_to; direction is how taskId reads " +
  "the link: outgoing means taskId blocks, duplicates, is a regression of, or relates to " +
  "otherTaskId, incoming the reverse (taskId is blocked by it, and so on). relates_to reads " +
  "the same both ways. Each task is an id or a key, such as OPA-12, in any project the " +
  "agent may reach.";

/** "OPA-12 blocks API-3", as `taskId` reads the link. */
function reading(task: Task, link: LinkInput): string {
  const shown = task.links.find(
    (each) =>
      each.type === link.type &&
      each.direction === link.direction &&
      (each.task.id === link.otherTaskId || each.task.key === link.otherTaskId),
  );
  return `${task.key} ${LINK_READINGS[link.type][link.direction]} ${shown?.task.key ?? link.otherTaskId}`;
}

export const addLink: ToolDefinition = {
  name: "opanel_add_link",
  permissions: PERMISSIONS,
  register(server, { api, redact }) {
    server.registerTool(
      "opanel_add_link",
      {
        title: "Link two Opanel tasks",
        description:
          `Links taskId to otherTaskId. ${ABOUT} A link that exists already is refused. ` +
          "Both tasks get a new version and a history entry. " +
          `${CHANGES_OPANEL} Needs tasks:write and tasks:read, on both tasks. ` +
          DATA_NOT_INSTRUCTIONS,
        inputSchema,
        outputSchema: taskSchema,
        annotations: WRITE,
      },
      async (link) => {
        const added = await api.send(
          "POST",
          `/tasks/${encodeURIComponent(link.taskId)}/links`,
          { type: link.type, direction: link.direction, taskId: link.otherTaskId },
          taskSchema,
        );
        if (!added.ok) return toolError(added.error, redact);
        const task = added.value;
        return readResult(
          `Linked: ${reading(task, link)}. Its version is now ${String(task.version)}.`,
          task,
          redact,
        );
      },
    );
  },
};

export const removeLink: ToolDefinition = {
  name: "opanel_remove_link",
  permissions: PERMISSIONS,
  register(server, { api, redact }) {
    server.registerTool(
      "opanel_remove_link",
      {
        title: "Remove a link between two Opanel tasks",
        description:
          `Removes the link between taskId and otherTaskId, named as taskId reads it. ${ABOUT} ` +
          "Both tasks get a new version and a history entry; the answer is taskId's task, " +
          `read after. ${CHANGES_OPANEL} Needs tasks:write and tasks:read, on both tasks. ` +
          DATA_NOT_INSTRUCTIONS,
        inputSchema,
        outputSchema: taskSchema,
        annotations: REPLACING_WRITE,
      },
      async (link) => {
        const path = `/tasks/${encodeURIComponent(link.taskId)}`;
        const removed = await api.remove(
          `${path}/links${query({ type: link.type, direction: link.direction, taskId: link.otherTaskId })}`,
        );
        if (!removed.ok) return toolError(removed.error, redact);
        // The `204` carries no task: read it, so the assistant has its new version
        // (WS-137 question 2).
        const read = await api.get(path, taskSchema);
        if (!read.ok) {
          const failed = toolError(read.error, redact);
          const detail = failed.content
            .map((block) => ("text" in block ? block.text : ""))
            .join("");
          return messageError(
            `The link was removed, but ${link.taskId} could not be read after: ${detail}`,
            redact,
          );
        }
        const task = read.value;
        const words = `${task.key} ${LINK_READINGS[link.type][link.direction]} ${link.otherTaskId}`;
        return readResult(
          `Removed the link: ${words}. Its version is now ${String(task.version)}.`,
          task,
          redact,
        );
      },
    );
  },
};
