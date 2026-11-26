import { type LabelList, labelListSchema } from "@/lib/schemas/labels";
import { projectParamsSchema } from "@/lib/schemas/projects";

import { toolError } from "../errors";
import type { ToolDefinition } from "../tools";
import { count, DATA_NOT_INSTRUCTIONS, quote, READ_ONLY, readResult } from "./results";

// `opanel_list_labels`: every label of a project, in one answer (WS-132 section 2).

const NAME = "opanel_list_labels";

function summary(list: LabelList): string {
  if (list.items.length === 0) return "No labels.";
  const names = list.items.map((label) => quote(label.name)).join(", ");
  return `${count(list.items.length, "label", "labels")}: ${names}.`;
}

export const listLabels: ToolDefinition = {
  name: NAME,
  permissions: ["tasks:read"],
  register(server, { api, redact }) {
    server.registerTool(
      NAME,
      {
        title: "List an Opanel project's labels",
        description:
          "Answers every label of a project, by name, with its id and colour; a label id " +
          "filters opanel_search_tasks and opanel_get_backlog. projectId is the project's id " +
          "or key, such as OPA. Agents read labels but do not apply them. Needs tasks:read. " +
          DATA_NOT_INSTRUCTIONS,
        inputSchema: projectParamsSchema,
        outputSchema: labelListSchema,
        annotations: READ_ONLY,
      },
      async ({ projectId }) => {
        const result = await api.get(
          `/projects/${encodeURIComponent(projectId)}/labels`,
          labelListSchema,
        );
        if (!result.ok) return toolError(result.error, redact);
        return readResult(summary(result.value), result.value, redact);
      },
    );
  },
};
