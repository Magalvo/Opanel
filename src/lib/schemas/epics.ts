import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";
import { versionConflictResponse } from "@/lib/openapi/responses";

import { pageSchema, paginationQuerySchema } from "./pagination";
import { projectParamsSchema } from "./projects";
import { versionSchema } from "./version";

export const epicStatusSchema = z.enum(["open", "closed"]).meta({ id: "EpicStatus" });

export type EpicStatus = z.infer<typeof epicStatusSchema>;

/** Trimmed, 1 to 200 characters (the task title rule). */
export const epicTitleSchema = z.string().trim().min(1).max(200);

/** Markdown, up to 50 000 characters, kept as written. */
export const epicDescriptionSchema = z.string().max(50_000);

/** A calendar date, `YYYY-MM-DD` (doc 0004 section 3), or `null` for none. */
const calendarDateSchema = z.iso.date().nullable();

/** `{ id, title }` of an epic, as a task shows it. */
export const epicRefSchema = z
  .strictObject({ id: z.uuid(), title: z.string() })
  .meta({ id: "EpicRef" });

export const epicSchema = z
  .strictObject({
    id: z.uuid(),
    projectId: z.uuid(),
    title: z.string(),
    description: z.string().meta({ description: "Markdown." }),
    status: epicStatusSchema,
    startDate: z.iso.date().nullable(),
    targetDate: z.iso.date().nullable(),
    progress: z.strictObject({ doneTasks: z.int().min(0), totalTasks: z.int().min(0) }).meta({
      description:
        "Tasks of the epic that are not deleted; done ones are in a column of the `done` category.",
    }),
    version: z.int().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Epic" });

export type Epic = z.infer<typeof epicSchema>;

export const epicPageSchema = pageSchema(epicSchema).meta({ id: "EpicPage" });

export type EpicPage = z.infer<typeof epicPageSchema>;

export const epicQuerySchema = paginationQuerySchema.extend({
  status: z
    .enum(["open", "closed", "all"])
    .optional()
    .meta({ description: "Which epics to list. By default only open ones." }),
});

export type EpicQuery = z.infer<typeof epicQuerySchema>;

/** The target date may not come before the start date when both are set. */
function datesOrdered(body: {
  startDate?: string | null | undefined;
  targetDate?: string | null | undefined;
}): boolean {
  return !body.startDate || !body.targetDate || body.targetDate >= body.startDate;
}

const DATES_MESSAGE = {
  message: "The target date may not be before the start date.",
  path: ["targetDate"],
};

export const createEpicRequestSchema = z
  .strictObject({
    title: epicTitleSchema,
    description: epicDescriptionSchema.optional(),
    startDate: calendarDateSchema.optional(),
    targetDate: calendarDateSchema.optional(),
  })
  .refine(datesOrdered, DATES_MESSAGE)
  .meta({ id: "CreateEpicRequest" });

export type CreateEpicRequest = z.infer<typeof createEpicRequestSchema>;

export const updateEpicRequestSchema = z
  .strictObject({
    title: epicTitleSchema.optional(),
    description: epicDescriptionSchema.optional(),
    status: epicStatusSchema.optional(),
    startDate: calendarDateSchema.optional().meta({ description: "`null` clears it." }),
    targetDate: calendarDateSchema.optional().meta({ description: "`null` clears it." }),
    version: versionSchema,
  })
  .refine(
    (body) =>
      body.title !== undefined ||
      body.description !== undefined ||
      body.status !== undefined ||
      body.startDate !== undefined ||
      body.targetDate !== undefined,
    { message: "Send at least one field to change." },
  )
  .refine(datesOrdered, DATES_MESSAGE)
  .meta({ id: "UpdateEpicRequest" });

export type UpdateEpicRequest = z.infer<typeof updateEpicRequestSchema>;

export const epicParamsSchema = z.strictObject({ epicId: z.uuid() });

const READ = { kind: "permission", permission: "tasks:read" } as const;
const MANAGE = { kind: "permission", permission: "epics:manage" } as const;
const NOT_JSON = { description: "The body is not JSON.", problem: true } as const;

export const listEpicsContract = {
  method: "get",
  path: "/api/v1/projects/{projectId}/epics",
  summary: "List a project's epics",
  description: "Epics ordered by title, ignoring case, with keyset pagination.",
  access: READ,
  request: { params: projectParamsSchema, query: epicQuerySchema },
  responses: {
    200: { description: "A page of epics.", schema: epicPageSchema },
    400: { description: "The path or the query string is not valid.", problem: true },
    404: { description: "There is no such project.", problem: true },
  },
} satisfies EndpointContract;

export const createEpicContract = {
  method: "post",
  path: "/api/v1/projects/{projectId}/epics",
  summary: "Create an epic",
  access: MANAGE,
  request: { params: projectParamsSchema, body: createEpicRequestSchema },
  responses: {
    201: { description: "The new epic, open.", schema: epicSchema },
    400: { description: "The path or the body is not valid.", problem: true },
    404: { description: "There is no such project.", problem: true },
    409: { description: "The project is archived (code `project_archived`).", problem: true },
    415: NOT_JSON,
  },
} satisfies EndpointContract;

export const getEpicContract = {
  method: "get",
  path: "/api/v1/epics/{epicId}",
  summary: "Get an epic with its progress",
  access: READ,
  request: { params: epicParamsSchema },
  responses: {
    200: { description: "The epic.", schema: epicSchema },
    400: { description: "The path is not valid.", problem: true },
    404: { description: "There is no such epic.", problem: true },
  },
} satisfies EndpointContract;

export const updateEpicContract = {
  method: "patch",
  path: "/api/v1/epics/{epicId}",
  summary: "Edit, close or reopen an epic",
  description:
    "Send the `version` the change is based on. `status` closes or reopens the epic. An " +
    "archived project cannot change (code `project_archived`).",
  access: MANAGE,
  request: { params: epicParamsSchema, body: updateEpicRequestSchema },
  responses: {
    200: { description: "The epic after the change.", schema: epicSchema },
    400: { description: "The path or the body is not valid.", problem: true },
    404: { description: "There is no such epic.", problem: true },
    409: versionConflictResponse(epicSchema),
    415: NOT_JSON,
  },
} satisfies EndpointContract;
