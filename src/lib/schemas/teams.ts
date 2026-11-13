import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";

import { accountNameSchema } from "./accounts";
import { pageSchema, paginationQuerySchema } from "./pagination";
import { personSchema } from "./people";

/** A team's name: trimmed, 1 to 100 characters, unique regardless of letter case. */
export const teamNameSchema = accountNameSchema;

export const teamSummarySchema = z
  .strictObject({
    id: z.uuid(),
    name: z.string(),
    memberCount: z.int().min(0),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "TeamSummary" });

export type TeamSummary = z.infer<typeof teamSummarySchema>;

export const teamPageSchema = pageSchema(teamSummarySchema).meta({ id: "TeamPage" });

export type TeamPage = z.infer<typeof teamPageSchema>;

export const teamSchema = z
  .strictObject({
    id: z.uuid(),
    name: z.string(),
    members: z.array(personSchema).meta({ description: "Every member, ordered by name." }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Team" });

export type Team = z.infer<typeof teamSchema>;

export const createTeamRequestSchema = z
  .strictObject({ name: teamNameSchema })
  .meta({ id: "CreateTeamRequest" });

export const updateTeamRequestSchema = z
  .strictObject({ name: teamNameSchema })
  .meta({ id: "UpdateTeamRequest" });

export type TeamNameRequest = z.infer<typeof createTeamRequestSchema>;

export const addMemberRequestSchema = z
  .strictObject({ accountId: z.uuid() })
  .meta({ id: "AddTeamMemberRequest" });

export type AddMemberRequest = z.infer<typeof addMemberRequestSchema>;

export const teamIdParamsSchema = z.strictObject({ teamId: z.uuid() });

export const teamMemberParamsSchema = z.strictObject({ teamId: z.uuid(), accountId: z.uuid() });

const READ = { kind: "permission", permission: "projects:read" } as const;
const MANAGE = { kind: "permission", permission: "teams:manage" } as const;
const NO_TEAM = { description: "There is no such team.", problem: true } as const;
const NAME_TAKEN = {
  description: "Another team has this name, ignoring case (code `team_name_taken`).",
  problem: true,
} as const;
const NOT_JSON = { description: "The body is not JSON.", problem: true } as const;

export const listTeamsContract = {
  method: "get",
  path: "/api/v1/teams",
  summary: "List teams",
  description: "Lists teams ordered by name, with keyset pagination.",
  access: READ,
  request: { query: paginationQuerySchema },
  responses: {
    200: { description: "A page of teams.", schema: teamPageSchema },
    400: { description: "The query string is not valid.", problem: true },
  },
} satisfies EndpointContract;

export const createTeamContract = {
  method: "post",
  path: "/api/v1/teams",
  summary: "Create a team",
  access: MANAGE,
  request: { body: createTeamRequestSchema },
  responses: {
    201: { description: "The new team, with no members.", schema: teamSchema },
    400: { description: "The body is not valid.", problem: true },
    409: NAME_TAKEN,
    415: NOT_JSON,
  },
} satisfies EndpointContract;

export const getTeamContract = {
  method: "get",
  path: "/api/v1/teams/{teamId}",
  summary: "Get a team and its members",
  access: READ,
  request: { params: teamIdParamsSchema },
  responses: {
    200: { description: "The team.", schema: teamSchema },
    400: { description: "The path is not valid.", problem: true },
    404: NO_TEAM,
  },
} satisfies EndpointContract;

export const updateTeamContract = {
  method: "patch",
  path: "/api/v1/teams/{teamId}",
  summary: "Rename a team",
  access: MANAGE,
  request: { params: teamIdParamsSchema, body: updateTeamRequestSchema },
  responses: {
    200: { description: "The team after the change.", schema: teamSchema },
    400: { description: "The path or the body is not valid.", problem: true },
    404: NO_TEAM,
    409: NAME_TAKEN,
    415: NOT_JSON,
  },
} satisfies EndpointContract;

export const deleteTeamContract = {
  method: "delete",
  path: "/api/v1/teams/{teamId}",
  summary: "Delete a team",
  description: "Deletes the team and its memberships. The people stay.",
  access: MANAGE,
  request: { params: teamIdParamsSchema },
  responses: {
    204: { description: "The team was deleted.", noContent: true },
    400: { description: "The path is not valid.", problem: true },
    404: NO_TEAM,
  },
} satisfies EndpointContract;

export const addTeamMemberContract = {
  method: "post",
  path: "/api/v1/teams/{teamId}/members",
  summary: "Add a person to a team",
  description:
    "Adding someone who is already a member changes nothing and succeeds. Only active " +
    "people can be added.",
  access: MANAGE,
  request: { params: teamIdParamsSchema, body: addMemberRequestSchema },
  responses: {
    200: { description: "The team after the change.", schema: teamSchema },
    400: {
      description: "The path or the body is not valid, or `accountId` is not a person.",
      problem: true,
    },
    404: NO_TEAM,
    409: { description: "The person is deactivated (code `account_inactive`).", problem: true },
    415: NOT_JSON,
  },
} satisfies EndpointContract;

export const removeTeamMemberContract = {
  method: "delete",
  path: "/api/v1/teams/{teamId}/members/{accountId}",
  summary: "Remove a person from a team",
  access: MANAGE,
  request: { params: teamMemberParamsSchema },
  responses: {
    204: { description: "The person is no longer a member.", noContent: true },
    400: { description: "The path is not valid.", problem: true },
    404: { description: "There is no such team, or the person is not a member.", problem: true },
  },
} satisfies EndpointContract;
