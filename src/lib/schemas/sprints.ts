import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";
import { PAYLOAD_TOO_LARGE, versionConflictResponse } from "@/lib/openapi/responses";

import { calendarDateSchema } from "./dates";
import { MAX_FILTER_VALUES, pageSchema, paginationQuerySchema } from "./pagination";
import { projectParamsSchema } from "./projects";
import { versionSchema } from "./version";

// Sprints (canonical doc 0003 section 6, WT-10 decisions 3, 4, 8 and 10, WS-140).

export const sprintStateSchema = z
  .enum(["planned", "active", "completed"])
  .meta({ id: "SprintState" });

export type SprintState = z.infer<typeof sprintStateSchema>;

/** A task's sprint, as a task shows it (WS-141). */
export const sprintRefSchema = z
  .strictObject({ id: z.uuid(), name: z.string(), state: sprintStateSchema })
  .meta({ id: "SprintRef" });

export type SprintRef = z.infer<typeof sprintRefSchema>;

/** Trimmed, 1 to 100 characters. */
export const sprintNameSchema = z.string().trim().min(1).max(100);

/** Markdown, up to 2 000 characters, kept as written. */
export const sprintGoalSchema = z.string().max(2_000);

export const sprintSchema = z
  .strictObject({
    id: z.uuid(),
    projectId: z.uuid(),
    name: z.string(),
    goal: z.string().meta({ description: "Markdown." }),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    state: sprintStateSchema,
    startedAt: z.iso
      .datetime()
      .nullable()
      .meta({ description: "When the sprint was started; `null` while planned." }),
    completedAt: z.iso
      .datetime()
      .nullable()
      .meta({ description: "When the sprint was completed; `null` until then." }),
    version: z.int().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Sprint" });

export type Sprint = z.infer<typeof sprintSchema>;

export const sprintPageSchema = pageSchema(sprintSchema).meta({ id: "SprintPage" });

export type SprintPage = z.infer<typeof sprintPageSchema>;

export const sprintQuerySchema = paginationQuerySchema.extend({
  state: z
    .union([sprintStateSchema, z.array(sprintStateSchema).min(1).max(MAX_FILTER_VALUES)])
    .transform((given): SprintState[] => (Array.isArray(given) ? given : [given]))
    .optional()
    .meta({
      description:
        "Only sprints in this state. Repeat it for any of several states. By default all.",
    }),
});

export type SprintQuery = z.infer<typeof sprintQuerySchema>;

const DATES_MESSAGE = {
  message: "The end date may not be before the start date.",
  path: ["endDate"],
};

export const createSprintRequestSchema = z
  .strictObject({
    name: sprintNameSchema,
    goal: sprintGoalSchema.optional(),
    startDate: calendarDateSchema,
    endDate: calendarDateSchema,
  })
  .refine((body) => body.endDate >= body.startDate, DATES_MESSAGE)
  .meta({ id: "CreateSprintRequest" });

export type CreateSprintRequest = z.infer<typeof createSprintRequestSchema>;

export const updateSprintRequestSchema = z
  .strictObject({
    name: sprintNameSchema.optional(),
    goal: sprintGoalSchema.optional(),
    startDate: calendarDateSchema.optional(),
    endDate: calendarDateSchema.optional(),
    version: versionSchema,
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.goal !== undefined ||
      body.startDate !== undefined ||
      body.endDate !== undefined,
    { message: "Send at least one field to change." },
  )
  .meta({ id: "UpdateSprintRequest" });

export type UpdateSprintRequest = z.infer<typeof updateSprintRequestSchema>;

export const sprintParamsSchema = z.strictObject({ sprintId: z.uuid() });

const READ = { kind: "permission", permission: "tasks:read" } as const;
const MANAGE = { kind: "permission", permission: "sprints:manage" } as const;
const NOT_JSON = { description: "The body is not JSON.", problem: true } as const;
const NO_SPRINT = { description: "There is no such sprint.", problem: true } as const;

export const listSprintsContract = {
  method: "get",
  path: "/api/v1/projects/{projectId}/sprints",
  summary: "List a project's sprints",
  description:
    "Sprints ordered by start date, then creation, with keyset pagination. `state` keeps " +
    "only sprints in the given states.",
  access: READ,
  request: { params: projectParamsSchema, query: sprintQuerySchema },
  responses: {
    200: { description: "A page of sprints.", schema: sprintPageSchema },
    400: { description: "The path or the query string is not valid.", problem: true },
    404: { description: "There is no such project.", problem: true },
  },
} satisfies EndpointContract;

export const createSprintContract = {
  method: "post",
  path: "/api/v1/projects/{projectId}/sprints",
  summary: "Create a sprint",
  description: "The sprint starts planned. The end date may not be before the start date.",
  access: MANAGE,
  request: { params: projectParamsSchema, body: createSprintRequestSchema },
  responses: {
    201: { description: "The new sprint, planned.", schema: sprintSchema },
    400: { description: "The path or the body is not valid.", problem: true },
    404: { description: "There is no such project.", problem: true },
    409: {
      description:
        "The project does not use sprints (code `sprints_disabled`), or it is archived " +
        "(code `project_archived`).",
      problem: true,
    },
    413: PAYLOAD_TOO_LARGE,
    415: NOT_JSON,
  },
} satisfies EndpointContract;

export const getSprintContract = {
  method: "get",
  path: "/api/v1/sprints/{sprintId}",
  summary: "Get a sprint",
  access: READ,
  request: { params: sprintParamsSchema },
  responses: {
    200: { description: "The sprint.", schema: sprintSchema },
    400: { description: "The path is not valid.", problem: true },
    404: NO_SPRINT,
  },
} satisfies EndpointContract;

export const updateSprintContract = {
  method: "patch",
  path: "/api/v1/sprints/{sprintId}",
  summary: "Edit a sprint",
  description:
    "Changes the name, goal or dates. Send the `version` the change is based on. A " +
    "completed sprint cannot change; the end date may not be before the start date.",
  access: MANAGE,
  request: { params: sprintParamsSchema, body: updateSprintRequestSchema },
  responses: {
    200: { description: "The sprint after the change.", schema: sprintSchema },
    400: { description: "The path or the body is not valid.", problem: true },
    404: NO_SPRINT,
    409: versionConflictResponse(sprintSchema, [
      "project_archived",
      "sprint_completed",
      "sprints_disabled",
    ]),
    413: PAYLOAD_TOO_LARGE,
    415: NOT_JSON,
  },
} satisfies EndpointContract;

export const deleteSprintContract = {
  method: "delete",
  path: "/api/v1/sprints/{sprintId}",
  summary: "Delete a planned sprint",
  description: "Only a planned sprint can be deleted, also while the project does not use sprints.",
  access: MANAGE,
  request: { params: sprintParamsSchema },
  responses: {
    204: { description: "The sprint is deleted.", noContent: true },
    400: { description: "The path is not valid.", problem: true },
    404: NO_SPRINT,
    409: {
      description:
        "The sprint is active or completed (code `sprint_not_planned`), or the project is " +
        "archived (code `project_archived`).",
      problem: true,
    },
  },
} satisfies EndpointContract;
