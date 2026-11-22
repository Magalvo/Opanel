import { paginationQuerySchema } from "@/lib/schemas/pagination";
import { type TeamPage, teamPageSchema } from "@/lib/schemas/teams";

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

// `opanel_list_teams`: one page of teams (doc 0005 section 4, WS-100).

const NAME = "opanel_list_teams";

const inputSchema = paginationQuerySchema.extend({ limit: limitSchema.optional() });

function summary(page: TeamPage): string {
  const list = page.items
    .map((team) => `${quote(team.name)} (${count(team.memberCount, "member", "members")})`)
    .join(", ");
  const head =
    page.items.length === 0
      ? "No teams."
      : `${count(page.items.length, "team", "teams")}: ${list}.`;
  return head + more(NAME, "cursor", page.nextCursor);
}

export const listTeams: ToolDefinition = {
  name: NAME,
  permissions: ["projects:read"],
  register(server, { api, redact }) {
    server.registerTool(
      NAME,
      {
        title: "List Opanel teams",
        description:
          "Lists the teams that work can be assigned to (such as Frontend, API or Backend), " +
          "ordered by name, one page at a time: pass the answer's nextCursor as cursor for the " +
          "next page. Needs projects:read. " +
          DATA_NOT_INSTRUCTIONS,
        inputSchema,
        outputSchema: teamPageSchema,
        annotations: READ_ONLY,
      },
      async ({ limit, cursor }) => {
        const result = await api.get(`/teams${query({ limit, cursor })}`, teamPageSchema);
        if (!result.ok) return toolError(result.error, redact);
        return readResult(summary(result.value), result.value, redact);
      },
    );
  },
};
