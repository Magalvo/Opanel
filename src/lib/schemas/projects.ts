import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";
import { versionConflictResponse } from "@/lib/openapi/responses";

import { accountNameSchema } from "./accounts";
import { pageSchema, paginationQuerySchema } from "./pagination";
import { versionSchema } from "./version";

/** 2 to 10 uppercase letters and digits, starting with a letter. Never changes (WT-03 d. 2). */
export const projectKeySchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{1,9}$/, "2 to 10 uppercase letters and digits, starting with a letter.");

/** A project's name: trimmed, 1 to 100 characters. Not unique; the key is. */
export const projectNameSchema = accountNameSchema;

/** Markdown, up to 10 000 characters, kept as written. */
export const projectDescriptionSchema = z.string().max(10_000);

export const projectSchema = z
  .strictObject({
    id: z.uuid(),
    key: z.string(),
    name: z.string(),
    description: z.string().meta({ description: "Markdown." }),
    archivedAt: z.iso
      .datetime()
      .nullable()
      .meta({ description: "Set while the project is archived and read-only." }),
    version: z.int().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Project" });

export type Project = z.infer<typeof projectSchema>;

export const projectPageSchema = pageSchema(projectSchema).meta({ id: "ProjectPage" });

export type ProjectPage = z.infer<typeof projectPageSchema>;

export const projectQuerySchema = paginationQuerySchema.extend({
  archived: z
    .enum(["true", "false"])
    .optional()
    .meta({ description: "`true` lists only archived projects; by default only active ones." }),
});

export type ProjectQuery = z.infer<typeof projectQuerySchema>;

export const createProjectRequestSchema = z
  .strictObject({
    key: projectKeySchema,
    name: projectNameSchema,
    description: projectDescriptionSchema.optional(),
  })
  .meta({ id: "CreateProjectRequest" });

export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const updateProjectRequestSchema = z
  .strictObject({
    name: projectNameSchema.optional(),
    description: projectDescriptionSchema.optional(),
    version: versionSchema,
  })
  .refine((body) => body.name !== undefined || body.description !== undefined, {
    message: "Send name, description or both.",
  })
  .meta({ id: "UpdateProjectRequest" });

export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

/** The project's id or its key, in every project path (WS-028 section 3). */
export const projectRefSchema = z
  .union([z.uuid(), projectKeySchema])
  .meta({ description: "The project's id or its key." });

export const projectParamsSchema = z.strictObject({ projectId: projectRefSchema });

const READ = { kind: "permission", permission: "projects:read" } as const;
const MANAGE = { kind: "permission", permission: "projects:manage" } as const;
const NO_PROJECT = { description: "There is no such project.", problem: true } as const;
const BAD_PATH = { description: "The path is not valid.", problem: true } as const;

export const listProjectsContract = {
  method: "get",
  path: "/api/v1/projects",
  summary: "List projects",
  description: "Lists projects ordered by name, ignoring case, with keyset pagination.",
  access: READ,
  request: { query: projectQuerySchema },
  responses: {
    200: { description: "A page of projects.", schema: projectPageSchema },
    400: { description: "The query string is not valid.", problem: true },
  },
} satisfies EndpointContract;

export const createProjectContract = {
  method: "post",
  path: "/api/v1/projects",
  summary: "Create a project",
  description: 'The project starts with the columns "To do", "In progress" and "Done".',
  access: MANAGE,
  request: { body: createProjectRequestSchema },
  responses: {
    201: { description: "The new project.", schema: projectSchema },
    400: { description: "The body is not valid.", problem: true },
    409: { description: "The key is taken (code `project_key_taken`).", problem: true },
    415: { description: "The body is not JSON.", problem: true },
  },
} satisfies EndpointContract;

export const getProjectContract = {
  method: "get",
  path: "/api/v1/projects/{projectId}",
  summary: "Get a project",
  access: READ,
  request: { params: projectParamsSchema },
  responses: {
    200: { description: "The project.", schema: projectSchema },
    400: BAD_PATH,
    404: NO_PROJECT,
  },
} satisfies EndpointContract;

export const updateProjectContract = {
  method: "patch",
  path: "/api/v1/projects/{projectId}",
  summary: "Change a project's name or description",
  description:
    "Send the `version` the change is based on. An archived project cannot be changed " +
    "(code `project_archived`). The key never changes.",
  access: MANAGE,
  request: { params: projectParamsSchema, body: updateProjectRequestSchema },
  responses: {
    200: { description: "The project after the change.", schema: projectSchema },
    400: { description: "The path or the body is not valid.", problem: true },
    404: NO_PROJECT,
    409: versionConflictResponse(projectSchema),
    415: { description: "The body is not JSON.", problem: true },
  },
} satisfies EndpointContract;

export const archiveProjectContract = {
  method: "post",
  path: "/api/v1/projects/{projectId}/archive",
  summary: "Archive a project",
  description: "Makes the project and everything in it read-only. Archiving again changes nothing.",
  access: MANAGE,
  request: { params: projectParamsSchema },
  responses: {
    200: { description: "The archived project.", schema: projectSchema },
    400: BAD_PATH,
    404: NO_PROJECT,
  },
} satisfies EndpointContract;

export const unarchiveProjectContract = {
  method: "post",
  path: "/api/v1/projects/{projectId}/unarchive",
  summary: "Bring an archived project back",
  description: "Unarchiving an active project changes nothing.",
  access: MANAGE,
  request: { params: projectParamsSchema },
  responses: {
    200: { description: "The active project.", schema: projectSchema },
    400: BAD_PATH,
    404: NO_PROJECT,
  },
} satisfies EndpointContract;
