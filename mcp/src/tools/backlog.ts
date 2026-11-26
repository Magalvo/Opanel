import { z } from "zod";

import { projectParamsSchema } from "@/lib/schemas/projects";
import {
  backlogQuerySchema,
  DUE_ORDER,
  dueInOrder,
  type TaskPage,
  taskPageSchema,
} from "@/lib/schemas/tasks";

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
  taskLabel,
} from "./results";

// `opanel_get_backlog`: one page of a project's backlog, in the team's ranking, with the
// filters of `GET /projects/{projectId}/backlog` (WS-132 section 2, question 2).

const NAME = "opanel_get_backlog";

const inputSchema = z
  .strictObject({
    ...projectParamsSchema.shape,
    ...backlogQuerySchema.shape,
    limit: limitSchema.optional(),
  })
  .refine(dueInOrder, DUE_ORDER);

function summary(page: TaskPage): string {
  const list = page.items.map((task) => taskLabel(task)).join("; ");
  const head =
    page.items.length === 0
      ? "No tasks in the backlog."
      : `${count(page.items.length, "task", "tasks")} in the backlog, in rank order: ${list}.`;
  return head + more(NAME, "cursor", page.nextCursor);
}

export const getBacklog: ToolDefinition = {
  name: NAME,
  permissions: ["tasks:read"],
  register(server, { api, redact }) {
    server.registerTool(
      NAME,
      {
        title: "Get an Opanel backlog",
        description:
          "Answers one page of a project's backlog, the tasks that are not on its board, in " +
          "the team's ranking. projectId is the project's id or key, such as OPA. It takes " +
          "the filters of opanel_search_tasks but projectId and sort: each takes one value or " +
          "an array, none matches an empty field and me this agent. Pass the answer's " +
          "nextCursor as cursor for the next page. Needs tasks:read. " +
          DATA_NOT_INSTRUCTIONS,
        inputSchema,
        outputSchema: taskPageSchema,
        annotations: READ_ONLY,
      },
      async ({ projectId, ...rest }) => {
        const result = await api.get(
          `/projects/${encodeURIComponent(projectId)}/backlog${query(rest)}`,
          taskPageSchema,
        );
        if (!result.ok) return toolError(result.error, redact);
        return readResult(summary(result.value), result.value, redact);
      },
    );
  },
};
