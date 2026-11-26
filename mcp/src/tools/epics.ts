import { type EpicPage, epicPageSchema, epicQuerySchema } from "@/lib/schemas/epics";
import { projectParamsSchema } from "@/lib/schemas/projects";

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

// `opanel_list_epics`: one page of a project's epics, by title (WS-132 section 2; the
// follow-up of WS-104 question 2).

const NAME = "opanel_list_epics";

const inputSchema = projectParamsSchema.extend({
  status: epicQuerySchema.shape.status,
  limit: limitSchema.optional(),
  cursor: epicQuerySchema.shape.cursor,
});

function summary(page: EpicPage): string {
  const list = page.items.map((epic) => `${quote(epic.title)} (${epic.status})`).join(", ");
  const head =
    page.items.length === 0
      ? "No epics."
      : `${count(page.items.length, "epic", "epics")}: ${list}.`;
  return head + more(NAME, "cursor", page.nextCursor);
}

export const listEpics: ToolDefinition = {
  name: NAME,
  permissions: ["tasks:read"],
  register(server, { api, redact }) {
    server.registerTool(
      NAME,
      {
        title: "List an Opanel project's epics",
        description:
          "Answers one page of a project's epics, by title, with their ids, dates and " +
          "progress; an epic id goes in a task's epicId and filters opanel_search_tasks. " +
          "projectId is the project's id or key, such as OPA. status is open by default, " +
          "closed or all. Pass the answer's nextCursor as cursor for the next page. Needs " +
          "tasks:read. " +
          DATA_NOT_INSTRUCTIONS,
        inputSchema,
        outputSchema: epicPageSchema,
        annotations: READ_ONLY,
      },
      async ({ projectId, status, limit, cursor }) => {
        const result = await api.get(
          `/projects/${encodeURIComponent(projectId)}/epics${query({ status, limit, cursor })}`,
          epicPageSchema,
        );
        if (!result.ok) return toolError(result.error, redact);
        return readResult(summary(result.value), result.value, redact);
      },
    );
  },
};
