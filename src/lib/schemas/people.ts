import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";

import { pageSchema, paginationQuerySchema } from "./pagination";

/**
 * A person as every signed-in account may see them (WT-03 decision 17): a human account
 * that has chosen a password. Never an email, a role or an invitation state.
 */
export const personSchema = z
  .strictObject({
    id: z.uuid(),
    name: z.string(),
    active: z.boolean().meta({ description: "False once the account is deactivated." }),
  })
  .meta({ id: "Person" });

export type Person = z.infer<typeof personSchema>;

export const personPageSchema = pageSchema(personSchema).meta({ id: "PersonPage" });

export type PersonPage = z.infer<typeof personPageSchema>;

export const peopleQuerySchema = paginationQuerySchema.extend({
  q: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .meta({ description: "Only people whose name starts with this text, ignoring case." }),
});

export type PeopleQuery = z.infer<typeof peopleQuerySchema>;

export const listPeopleContract = {
  method: "get",
  path: "/api/v1/people",
  summary: "List people",
  description:
    "Lists the people who can be assigned work or added to a team, ordered by name, with " +
    "keyset pagination. Deactivated people are included with `active: false`; invited " +
    "accounts that have not chosen a password are not.",
  access: { kind: "permission", permission: "projects:read" },
  request: { query: peopleQuerySchema },
  responses: {
    200: { description: "A page of people.", schema: personPageSchema },
    400: { description: "The query string is not valid.", problem: true },
  },
} satisfies EndpointContract;
