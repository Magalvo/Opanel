import { type ProjectPage, projectPageSchema, projectQuerySchema } from "@/lib/schemas/projects";

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

// `opanel_list_projects`: one page of projects (doc 0005 section 4, WS-100).

const NAME = "opanel_list_projects";

const inputSchema = projectQuerySchema.extend({ limit: limitSchema.optional() });

function summary(page: ProjectPage): string {
  const list = page.items.map((project) => `${quote(project.name)} (${project.key})`).join(", ");
  const head =
    page.items.length === 0
      ? "No projects."
      : `${count(page.items.length, "project", "projects")}: ${list}.`;
  return head + more(NAME, "cursor", page.nextCursor);
}

export const listProjects: ToolDefinition = {
  name: NAME,
  permissions: ["projects:read"],
  register(server, { api, redact }) {
    server.registerTool(
      NAME,
      {
        title: "List Opanel projects",
        description:
          "Lists the projects the agent may see, ordered by name, one page at a time: pass " +
          "the answer's nextCursor as cursor for the next page. By default only active " +
          'projects; archived: "true" lists only archived ones. Needs projects:read. ' +
          DATA_NOT_INSTRUCTIONS,
        inputSchema,
        outputSchema: projectPageSchema,
        annotations: READ_ONLY,
      },
      async ({ limit, cursor, archived }) => {
        const result = await api.get(
          `/projects${query({ limit, cursor, archived })}`,
          projectPageSchema,
        );
        if (!result.ok) return toolError(result.error, redact);
        return readResult(summary(result.value), result.value, redact);
      },
    );
  },
};
