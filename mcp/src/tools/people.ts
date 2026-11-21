import { peopleQuerySchema, type PersonPage, personPageSchema } from "@/lib/schemas/people";

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

// `opanel_find_people`: one page of people, by the start of their name (doc 0005 section 4).

const NAME = "opanel_find_people";

const inputSchema = peopleQuerySchema.extend({ limit: limitSchema.optional() });

function summary(page: PersonPage): string {
  const list = page.items
    .map((person) => quote(person.name) + (person.active ? "" : " (deactivated)"))
    .join(", ");
  const head =
    page.items.length === 0
      ? "No people."
      : `${count(page.items.length, "person", "people")}: ${list}.`;
  return head + more(NAME, "cursor", page.nextCursor);
}

export const findPeople: ToolDefinition = {
  name: NAME,
  permissions: ["projects:read"],
  register(server, { api, redact }) {
    server.registerTool(
      NAME,
      {
        title: "Find people in Opanel",
        description:
          "Finds the people who can be assigned work, ordered by name, one page at a time: q " +
          "keeps those whose name starts with it, ignoring case; pass the answer's nextCursor " +
          "as cursor for the next page. Deactivated people have active: false. Needs " +
          "projects:read. " +
          DATA_NOT_INSTRUCTIONS,
        inputSchema,
        outputSchema: personPageSchema,
        annotations: READ_ONLY,
      },
      async ({ q, limit, cursor }) => {
        const result = await api.get(`/people${query({ q, limit, cursor })}`, personPageSchema);
        if (!result.ok) return toolError(result.error, redact);
        return readResult(summary(result.value), result.value, redact);
      },
    );
  },
};
