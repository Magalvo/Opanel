import { projectParamsSchema } from "@/lib/schemas/projects";
import {
  type Sprint,
  type SprintPage,
  sprintPageSchema,
  sprintQuerySchema,
} from "@/lib/schemas/sprints";

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

// `opanel_list_sprints`: one page of a project's sprints, by start date (WS-143 section 7,
// WT-10 decision 16 and proposal P4). Agents read sprints; starting and completing them is
// a Manager's.

const NAME = "opanel_list_sprints";

const inputSchema = projectParamsSchema.extend({
  state: sprintQuerySchema.shape.state,
  limit: limitSchema.optional(),
  cursor: sprintQuerySchema.shape.cursor,
});

function described(sprint: Sprint): string {
  const { donePoints, totalPoints } = sprint.progress;
  return `${quote(sprint.name)} (${sprint.state}, ${String(donePoints)}/${String(totalPoints)} points)`;
}

function summary(page: SprintPage): string {
  const head =
    page.items.length === 0
      ? "No sprints."
      : `${count(page.items.length, "sprint", "sprints")}: ${page.items.map(described).join(", ")}.`;
  return head + more(NAME, "cursor", page.nextCursor);
}

export const listSprints: ToolDefinition = {
  name: NAME,
  permissions: ["tasks:read"],
  register(server, { api, redact }) {
    server.registerTool(
      NAME,
      {
        title: "List an Opanel project's sprints",
        description:
          "Answers one page of a project's sprints, by start date, with their ids, dates, " +
          "state (planned, active or completed) and progress in tasks and story points. A " +
          "sprint id goes in a task's sprintId and filters opanel_search_tasks; " +
          "sprintId=active names the project's active sprint without its id. projectId is " +
          "the project's id or key, such as OPA. state keeps only sprints in one or more " +
          "states; by default all. Pass the answer's nextCursor as cursor for the next page. " +
          "Starting and completing sprints is a Manager's, in the web app, not an agent's. " +
          "Needs tasks:read. " +
          DATA_NOT_INSTRUCTIONS,
        inputSchema,
        outputSchema: sprintPageSchema,
        annotations: READ_ONLY,
      },
      async ({ projectId, state, limit, cursor }) => {
        const result = await api.get(
          `/projects/${encodeURIComponent(projectId)}/sprints${query({ state, limit, cursor })}`,
          sprintPageSchema,
        );
        if (!result.ok) return toolError(result.error, redact);
        return readResult(summary(result.value), result.value, redact);
      },
    );
  },
};
