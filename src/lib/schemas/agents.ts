import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";
import { PAYLOAD_TOO_LARGE } from "@/lib/openapi/responses";

import { pageSchema, paginationQuerySchema } from "./pagination";
import {
  AGENT_SCOPES,
  type AgentRole,
  agentRoleSchema,
  type AgentScope,
  agentScopeSchema,
} from "./permissions";

// The Admin API for agents and their tokens (WT-05 item C, WS-075).

/** The scopes each agent role starts with (doc 0001 section 3); mirrors `roles.ts`. */
const ROLE_SCOPES: Readonly<Record<AgentRole, readonly AgentScope[]>> = {
  qa_agent: ["projects:read", "tasks:read", "reports:write", "comments:write"],
  worker_agent: AGENT_SCOPES,
};

export function scopesOfRole(role: AgentRole): readonly AgentScope[] {
  return ROLE_SCOPES[role];
}

export const agentNameSchema = z.string().trim().min(1).max(80);
const descriptionSchema = z.string().trim().min(1).max(500).nullable();
const scopesSchema = z
  .array(agentScopeSchema)
  .meta({ description: "The agent's permissions: a subset of its role's scopes." });
const projectIdsSchema = z.array(z.uuid()).nullable().meta({
  description: "The projects the agent may reach, or `null` for all of them.",
});

/** Adds field errors for scopes outside the role, duplicate scopes and duplicate projects. */
function checkAgentFields<
  Value extends {
    role?: AgentRole | undefined;
    scopes?: AgentScope[] | undefined;
    projectIds?: string[] | null | undefined;
  },
>(value: Value, context: z.RefinementCtx<Value>): void {
  const { role, scopes, projectIds } = value;
  if (scopes !== undefined) {
    if (new Set(scopes).size !== scopes.length) {
      context.addIssue({ code: "custom", path: ["scopes"], message: "Scopes must be unique." });
    }
    if (role !== undefined) {
      const allowed = scopesOfRole(role);
      const outside = scopes.filter((scope) => !allowed.includes(scope));
      if (outside.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["scopes"],
          message: `Not part of the role ${role}: ${outside.join(", ")}.`,
        });
      }
    }
  }
  if (projectIds && new Set(projectIds).size !== projectIds.length) {
    context.addIssue({ code: "custom", path: ["projectIds"], message: "Projects must be unique." });
  }
}

export const agentSchema = z
  .strictObject({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    role: agentRoleSchema,
    scopes: z.array(agentScopeSchema),
    projectIds: z.array(z.uuid()).nullable(),
    status: z.enum(["active", "disabled"]),
    createdAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime().nullable(),
  })
  .meta({ id: "Agent" });

export type Agent = z.infer<typeof agentSchema>;

export const agentPageSchema = pageSchema(agentSchema).meta({ id: "AgentPage" });
export type AgentPage = z.infer<typeof agentPageSchema>;

export const createAgentRequestSchema = z
  .strictObject({
    name: agentNameSchema,
    description: descriptionSchema.optional(),
    role: agentRoleSchema,
    scopes: scopesSchema.optional().meta({ description: "Default: every scope of the role." }),
    projectIds: projectIdsSchema,
  })
  .superRefine(checkAgentFields)
  .meta({ id: "CreateAgentRequest" });

export type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;

export const updateAgentRequestSchema = z
  .strictObject({
    name: agentNameSchema.optional(),
    description: descriptionSchema.optional(),
    role: agentRoleSchema.optional(),
    scopes: scopesSchema.optional(),
    projectIds: projectIdsSchema.optional(),
    active: z
      .boolean()
      .optional()
      .meta({ description: "`false` disables the agent, `true` re-enables it." }),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: "Send at least one field.",
  })
  .superRefine(checkAgentFields)
  .meta({ id: "UpdateAgentRequest" });

export type UpdateAgentRequest = z.infer<typeof updateAgentRequestSchema>;

export const apiTokenSchema = z
  .strictObject({
    id: z.uuid(),
    name: z.string(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().nullable(),
    lastUsedAt: z.iso.datetime().nullable(),
    revokedAt: z.iso.datetime().nullable(),
    status: z.enum(["active", "expired", "revoked"]),
  })
  .meta({ id: "ApiToken" });

export type ApiToken = z.infer<typeof apiTokenSchema>;

export const apiTokenListSchema = pageSchema(apiTokenSchema).meta({ id: "ApiTokenList" });
export type ApiTokenList = z.infer<typeof apiTokenListSchema>;

export const createApiTokenRequestSchema = z
  .strictObject({
    name: agentNameSchema,
    expiresInDays: z
      .union([z.literal(30), z.literal(90), z.literal(365), z.null()])
      .default(90)
      .meta({ description: "30, 90 (the default) or 365 days, or `null` for no expiry." }),
  })
  .meta({ id: "CreateApiTokenRequest" });

export type CreateApiTokenRequest = z.infer<typeof createApiTokenRequestSchema>;

export const createdApiTokenSchema = z
  .strictObject({
    token: z.string().meta({ description: "The token, `opk_…`. Shown only in this response." }),
    apiToken: apiTokenSchema,
  })
  .meta({ id: "CreatedApiToken" });

export type CreatedApiToken = z.infer<typeof createdApiTokenSchema>;

export const agentIdParamsSchema = z.strictObject({ agentId: z.uuid() });
export const apiTokenParamsSchema = z.strictObject({ agentId: z.uuid(), tokenId: z.uuid() });

const MANAGE = { kind: "permission", permission: "agents:manage" } as const;
const NO_AGENT = { description: "There is no such agent.", problem: true } as const;

export const listAgentsContract = {
  method: "get",
  path: "/api/v1/agents",
  summary: "List agents",
  description: "Lists agent accounts, ordered by name, with keyset pagination.",
  access: MANAGE,
  request: { query: paginationQuerySchema },
  responses: {
    200: { description: "A page of agents.", schema: agentPageSchema },
    400: { description: "The query string is not valid.", problem: true },
  },
} satisfies EndpointContract;

export const createAgentContract = {
  method: "post",
  path: "/api/v1/agents",
  summary: "Create an agent",
  description:
    "Creates an agent account with a role, scopes within that role, and the projects it may " +
    "reach. It has no token yet.",
  access: MANAGE,
  request: { body: createAgentRequestSchema },
  responses: {
    201: { description: "The agent.", schema: agentSchema },
    400: { description: "The body is not valid, or names an unknown project.", problem: true },
    409: { description: "Another agent has this name (code `agent_name_taken`).", problem: true },
    413: PAYLOAD_TOO_LARGE,
    415: { description: "The body is not JSON.", problem: true },
  },
} satisfies EndpointContract;

export const getAgentContract = {
  method: "get",
  path: "/api/v1/agents/{agentId}",
  summary: "Read an agent",
  access: MANAGE,
  request: { params: agentIdParamsSchema },
  responses: {
    200: { description: "The agent.", schema: agentSchema },
    400: { description: "The path is not valid.", problem: true },
    404: NO_AGENT,
  },
} satisfies EndpointContract;

export const updateAgentContract = {
  method: "patch",
  path: "/api/v1/agents/{agentId}",
  summary: "Change an agent",
  description:
    "Changes an agent's name, description, role, scopes or projects, or disables or " +
    "re-enables it. A disabled agent's tokens stop working at once. A role change without " +
    "`scopes` keeps the scopes the new role allows.",
  access: MANAGE,
  request: { params: agentIdParamsSchema, body: updateAgentRequestSchema },
  responses: {
    200: { description: "The agent after the change.", schema: agentSchema },
    400: { description: "The path or the body is not valid.", problem: true },
    404: NO_AGENT,
    409: { description: "Another agent has this name (code `agent_name_taken`).", problem: true },
    413: PAYLOAD_TOO_LARGE,
    415: { description: "The body is not JSON.", problem: true },
  },
} satisfies EndpointContract;

export const listApiTokensContract = {
  method: "get",
  path: "/api/v1/agents/{agentId}/tokens",
  summary: "List an agent's tokens",
  description: "Every token of the agent, newest first, revoked and expired ones included.",
  access: MANAGE,
  request: { params: agentIdParamsSchema },
  responses: {
    200: { description: "The tokens. Never their secret.", schema: apiTokenListSchema },
    400: { description: "The path is not valid.", problem: true },
    404: NO_AGENT,
  },
} satisfies EndpointContract;

export const createApiTokenContract = {
  method: "post",
  path: "/api/v1/agents/{agentId}/tokens",
  summary: "Create a token for an agent",
  description:
    "Creates an API token, shown only in this response. An agent holds at most 10 usable " +
    "tokens.",
  access: MANAGE,
  request: { params: agentIdParamsSchema, body: createApiTokenRequestSchema },
  responses: {
    201: { description: "The token and its details.", schema: createdApiTokenSchema },
    400: { description: "The path or the body is not valid.", problem: true },
    404: NO_AGENT,
    409: {
      description:
        "The agent already has 10 usable tokens (code `too_many_tokens`), or is disabled " +
        "(code `agent_disabled`).",
      problem: true,
    },
    413: PAYLOAD_TOO_LARGE,
    415: { description: "The body is not JSON.", problem: true },
  },
} satisfies EndpointContract;

export const revokeApiTokenContract = {
  method: "delete",
  path: "/api/v1/agents/{agentId}/tokens/{tokenId}",
  summary: "Revoke a token",
  description: "The token stops working at once. Revoking it again changes nothing.",
  access: MANAGE,
  request: { params: apiTokenParamsSchema },
  responses: {
    204: { description: "The token is revoked.", noContent: true },
    400: { description: "The path is not valid.", problem: true },
    404: { description: "The agent has no such token.", problem: true },
  },
} satisfies EndpointContract;
