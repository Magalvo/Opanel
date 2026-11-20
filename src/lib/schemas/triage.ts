import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";
import { BAD_PATH, PAYLOAD_TOO_LARGE, versionConflictResponse } from "@/lib/openapi/responses";

import { projectParamsSchema } from "./projects";
import { versionSchema } from "./version";

// A project's triage settings (canonical doc 0001 section 6, WT-06 decision 4, WS-087): the
// team a bug goes to when no rule names one, and the team of each layer. `unknown` is not a
// layer here: it always goes to the triage team.

const teamRef = z.uuid().nullable();

const rulesSchema = z.strictObject({ frontend: teamRef, api: teamRef, backend: teamRef });

export const triageSettingsSchema = z
  .strictObject({
    triageTeamId: teamRef.meta({
      description: "Where a bug goes for `unknown` or a layer with no team; null for none.",
    }),
    rules: rulesSchema.meta({ description: "The team of each layer; null for none." }),
    version: z.int().min(1).meta({ description: "The project's version." }),
  })
  .meta({ id: "TriageSettings" });

export type TriageSettings = z.infer<typeof triageSettingsSchema>;

/** A change: absent fields stay as they are, `null` clears (canonical doc 0004 section 6). */
export const updateTriageRequestSchema = z
  .strictObject({
    triageTeamId: teamRef.optional(),
    rules: rulesSchema.partial().optional(),
    version: versionSchema,
  })
  .meta({ id: "UpdateTriageRequest" });

export type UpdateTriageRequest = z.infer<typeof updateTriageRequestSchema>;

const NO_PROJECT = { description: "There is no such project.", problem: true } as const;

export const getTriageContract = {
  method: "get",
  path: "/api/v1/projects/{projectId}/triage",
  summary: "Get a project's triage settings",
  description:
    "Which team receives the bugs agents report for each layer, and the triage team that " +
    "receives `unknown` and any layer without a team.",
  access: { kind: "permission", permission: "projects:read" },
  request: { params: projectParamsSchema },
  responses: {
    200: { description: "The settings.", schema: triageSettingsSchema },
    400: BAD_PATH,
    404: NO_PROJECT,
  },
} satisfies EndpointContract;

export const updateTriageContract = {
  method: "patch",
  path: "/api/v1/projects/{projectId}/triage",
  summary: "Change a project's triage settings",
  description:
    "Send the project's `version` the change is based on; it grows by one. An absent field " +
    "is left as it is, `null` clears it. An archived project cannot be changed (code " +
    "`project_archived`).",
  access: { kind: "permission", permission: "teams:manage" },
  request: { params: projectParamsSchema, body: updateTriageRequestSchema },
  responses: {
    200: { description: "The settings after the change.", schema: triageSettingsSchema },
    400: {
      description: "The path or the body is not valid, or a team does not exist.",
      problem: true,
    },
    404: NO_PROJECT,
    409: versionConflictResponse(triageSettingsSchema, ["project_archived"]),
    413: PAYLOAD_TOO_LARGE,
    415: { description: "The body is not JSON.", problem: true },
  },
} satisfies EndpointContract;
