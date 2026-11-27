import { z } from "zod";

import {
  allTasksQuerySchema,
  DUE_ORDER,
  dueInOrder,
  type TaskListItemPage,
  taskListItemPageSchema,
} from "@/lib/schemas/tasks";

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
  taskLabel,
} from "./results";

// `opanel_search_tasks`: one page of the tasks of every project the agent may read, found by
// words or key, filtered and sorted as `GET /tasks` does (WS-132 section 2).

const NAME = "opanel_search_tasks";

const inputSchema = z
  .strictObject({ ...allTasksQuerySchema.shape, limit: limitSchema.optional() })
  .refine(dueInOrder, DUE_ORDER);

function summary(page: TaskListItemPage): string {
  const list = page.items
    .map(
      (task) =>
        `${taskLabel(task)} (${task.project.key}, ` +
        `${task.column === null ? "backlog" : quote(task.column.name)})`,
    )
    .join("; ");
  const head =
    page.items.length === 0
      ? "No tasks."
      : `${count(page.items.length, "task", "tasks")}: ${list}.`;
  return head + more(NAME, "cursor", page.nextCursor);
}

export const searchTasks: ToolDefinition = {
  name: NAME,
  permissions: ["tasks:read"],
  register(server, { api, redact }) {
    server.registerTool(
      NAME,
      {
        title: "Search Opanel tasks",
        description:
          "Finds tasks across every project this agent may read, board and backlog, one page " +
          "at a time. q finds a task by its key (OPA-12) or by words of its title and " +
          "description, the last word as a prefix. Each filter takes one value or an array of " +
          "up to 20, any of which may match; different filters must all hold; none matches an " +
          "empty field and me this agent. projectId names projects by id or key. sort is a " +
          "field (key, title, priority, dueDate, storyPoints, created, updated), with - for " +
          "descending; " +
          "-updated by default. Pass the answer's nextCursor as cursor for the next page. " +
          "Needs tasks:read. " +
          DATA_NOT_INSTRUCTIONS,
        inputSchema,
        outputSchema: taskListItemPageSchema,
        annotations: READ_ONLY,
      },
      async (input) => {
        const result = await api.get(`/tasks${query(input)}`, taskListItemPageSchema);
        if (!result.ok) return toolError(result.error, redact);
        return readResult(summary(result.value), result.value, redact);
      },
    );
  },
};
