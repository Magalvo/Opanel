import { activityPageSchema, activityQuerySchema } from "@/lib/schemas/activity";
import { taskParamsSchema } from "@/lib/schemas/tasks";

import { toolError } from "../errors";
import type { ToolDefinition } from "../tools";
import {
  count,
  DATA_NOT_INSTRUCTIONS,
  limitSchema,
  more,
  query,
  READ_ONLY,
  readResult,
} from "./results";

// `opanel_get_task_activity`: one page of a task's changes and comments, oldest first
// (WS-132 section 2).

const NAME = "opanel_get_task_activity";

const inputSchema = taskParamsSchema.extend({
  limit: limitSchema.optional(),
  cursor: activityQuerySchema.shape.cursor,
});

function summary(items: readonly { kind: string }[], nextCursor: string | null): string {
  const tail = more(NAME, "cursor", nextCursor);
  if (items.length === 0) return `No activity.${tail}`;
  const changes = items.filter((item) => item.kind === "event").length;
  return (
    `${count(items.length, "item", "items")}, oldest first: ` +
    `${count(changes, "change", "changes")} and ` +
    `${count(items.length - changes, "comment", "comments")}.${tail}`
  );
}

export const getTaskActivity: ToolDefinition = {
  name: NAME,
  permissions: ["tasks:read"],
  register(server, { api, redact }) {
    server.registerTool(
      NAME,
      {
        title: "Get an Opanel task's activity",
        description:
          "Answers one page of a task's activity, oldest first: each change, with who made it " +
          "(a person or an agent) and its old and new values, and each comment. Ids of " +
          "accounts, teams, columns and epics come with their names, null when deleted. " +
          "taskId is the task's id or key, such as OPA-12. Pass the answer's nextCursor as " +
          "cursor for the next page. Needs tasks:read. " +
          DATA_NOT_INSTRUCTIONS,
        inputSchema,
        outputSchema: activityPageSchema,
        annotations: READ_ONLY,
      },
      async ({ taskId, limit, cursor }) => {
        const result = await api.get(
          `/tasks/${encodeURIComponent(taskId)}/activity${query({ limit, cursor })}`,
          activityPageSchema,
        );
        if (!result.ok) return toolError(result.error, redact);
        const { items, nextCursor } = result.value;
        return readResult(summary(items, nextCursor), result.value, redact);
      },
    );
  },
};
