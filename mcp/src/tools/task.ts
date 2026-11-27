import { z } from "zod";

import { commentPageSchema, commentQuerySchema } from "@/lib/schemas/comments";
import { taskParamsSchema, taskSchema } from "@/lib/schemas/tasks";

import { toolError } from "../errors";
import type { ToolDefinition } from "../tools";
import {
  count,
  DATA_NOT_INSTRUCTIONS,
  limitSchema,
  more,
  query,
  quote,
  READ_ONLY,
  readResult,
} from "./results";

// `opanel_get_task`: a task with one page of its comments (doc 0005 section 4, WS-100).

const NAME = "opanel_get_task";

const inputSchema = taskParamsSchema.extend({
  commentsLimit: limitSchema.optional(),
  commentsCursor: commentQuerySchema.shape.cursor,
});

export const taskWithCommentsSchema = z.strictObject({
  task: taskSchema,
  comments: commentPageSchema,
});

export type TaskWithComments = z.infer<typeof taskWithCommentsSchema>;

/** The task's parent, sub-tasks and links, leaving out what does not apply (WS-137). */
function relations(task: TaskWithComments["task"]): string {
  const parts = [];
  if (task.parent !== null) parts.push(`A sub-task of ${task.parent.key}.`);
  if (task.subtasks !== null) {
    parts.push(`${String(task.subtasks.done)} of ${String(task.subtasks.total)} sub-tasks done.`);
  }
  if (task.links.length > 0) parts.push(`${count(task.links.length, "link", "links")}.`);
  return parts.map((part) => `${part} `).join("");
}

function summary({ task, comments }: TaskWithComments): string {
  return (
    `${task.key}, a ${task.type}: ${quote(task.title)}. ` +
    relations(task) +
    `${count(comments.items.length, "comment", "comments")} shown.` +
    more(NAME, "commentsCursor", comments.nextCursor, "More comments")
  );
}

export const getTask: ToolDefinition = {
  name: NAME,
  permissions: ["tasks:read"],
  register(server, { api, redact }) {
    server.registerTool(
      NAME,
      {
        title: "Get an Opanel task",
        description:
          "Answers a task, with its description, links and version, and one page of its " +
          "comments, oldest first. taskId is the task's id or key, such as OPA-12; pass the " +
          "answer's comments.nextCursor as commentsCursor for the next comments. Needs " +
          "tasks:read. " +
          DATA_NOT_INSTRUCTIONS,
        inputSchema,
        outputSchema: taskWithCommentsSchema,
        annotations: READ_ONLY,
      },
      async ({ taskId, commentsLimit, commentsCursor }) => {
        const task = await api.get(`/tasks/${encodeURIComponent(taskId)}`, taskSchema);
        if (!task.ok) return toolError(task.error, redact);
        const comments = await api.get(
          `/tasks/${task.value.id}/comments${query({ limit: commentsLimit, cursor: commentsCursor })}`,
          commentPageSchema,
        );
        if (!comments.ok) return toolError(comments.error, redact);
        const value = { task: task.value, comments: comments.value };
        return readResult(summary(value), value, redact);
      },
    );
  },
};
