import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";
import { versionConflictResponse } from "@/lib/openapi/responses";

import { accountNameSchema } from "./accounts";
import { projectParamsSchema } from "./projects";
import { versionSchema } from "./version";

export const columnCategorySchema = z.enum(["todo", "in_progress", "done"]).meta({
  id: "ColumnCategory",
  description: "What the column means for finished work; `done` counts as finished.",
});

export type ColumnCategory = z.infer<typeof columnCategorySchema>;

/** A column's name: trimmed, 1 to 100 characters, not unique within a project. */
export const columnNameSchema = accountNameSchema;

/** A column as the API shows it. Its ordering key is internal: lists come in board order. */
export const columnSchema = z
  .strictObject({
    id: z.uuid(),
    projectId: z.uuid(),
    name: z.string(),
    category: columnCategorySchema,
    version: z.int().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Column" });

export type Column = z.infer<typeof columnSchema>;

/** Every column of a project, in board order. Never paginated (WT-03 decision 10). */
export const columnListSchema = z
  .strictObject({ items: z.array(columnSchema), nextCursor: z.null() })
  .meta({ id: "ColumnList" });

export type ColumnList = z.infer<typeof columnListSchema>;

const anchorSchema = z.uuid().nullable().meta({
  description: "Place the column after this column of the same project; `null` places it first.",
});

export const createColumnRequestSchema = z
  .strictObject({
    name: columnNameSchema,
    category: columnCategorySchema,
    afterColumnId: anchorSchema
      .optional()
      .meta({ description: "Absent: at the end. `null`: first." }),
  })
  .meta({ id: "CreateColumnRequest" });

export type CreateColumnRequest = z.infer<typeof createColumnRequestSchema>;

export const updateColumnRequestSchema = z
  .strictObject({
    name: columnNameSchema.optional(),
    category: columnCategorySchema.optional(),
    version: versionSchema,
  })
  .refine((body) => body.name !== undefined || body.category !== undefined, {
    message: "Send name, category or both.",
  })
  .meta({ id: "UpdateColumnRequest" });

export type UpdateColumnRequest = z.infer<typeof updateColumnRequestSchema>;

export const moveColumnRequestSchema = z
  .strictObject({ afterColumnId: anchorSchema, version: versionSchema })
  .meta({ id: "MoveColumnRequest" });

export type MoveColumnRequest = z.infer<typeof moveColumnRequestSchema>;

export const columnParamsSchema = z.strictObject({ columnId: z.uuid() });

const MANAGE = { kind: "permission", permission: "projects:manage" } as const;
const NO_COLUMN = { description: "There is no such column.", problem: true } as const;
const NOT_JSON = { description: "The body is not JSON.", problem: true } as const;

export const listColumnsContract = {
  method: "get",
  path: "/api/v1/projects/{projectId}/columns",
  summary: "List a project's columns",
  description: "Every column of the project, in board order, in one response.",
  access: { kind: "permission", permission: "projects:read" },
  request: { params: projectParamsSchema },
  responses: {
    200: { description: "The columns.", schema: columnListSchema },
    400: { description: "The path is not valid.", problem: true },
    404: { description: "There is no such project.", problem: true },
  },
} satisfies EndpointContract;

export const createColumnContract = {
  method: "post",
  path: "/api/v1/projects/{projectId}/columns",
  summary: "Add a column",
  access: MANAGE,
  request: { params: projectParamsSchema, body: createColumnRequestSchema },
  responses: {
    201: { description: "The new column.", schema: columnSchema },
    400: { description: "The path or the body is not valid.", problem: true },
    404: { description: "There is no such project.", problem: true },
    409: { description: "The project is archived (code `project_archived`).", problem: true },
    415: NOT_JSON,
  },
} satisfies EndpointContract;

export const updateColumnContract = {
  method: "patch",
  path: "/api/v1/columns/{columnId}",
  summary: "Rename a column or change its category",
  description:
    "Send the `version` the change is based on. The project's last `done` column cannot " +
    "change category (code `last_done_column`); an archived project cannot change (code " +
    "`project_archived`).",
  access: MANAGE,
  request: { params: columnParamsSchema, body: updateColumnRequestSchema },
  responses: {
    200: { description: "The column after the change.", schema: columnSchema },
    400: { description: "The path or the body is not valid.", problem: true },
    404: NO_COLUMN,
    409: versionConflictResponse(columnSchema),
    415: NOT_JSON,
  },
} satisfies EndpointContract;

export const moveColumnContract = {
  method: "post",
  path: "/api/v1/columns/{columnId}/move",
  summary: "Move a column",
  description: "Places the column after another column of its project, or first.",
  access: MANAGE,
  request: { params: columnParamsSchema, body: moveColumnRequestSchema },
  responses: {
    200: { description: "The column after the move.", schema: columnSchema },
    400: { description: "The path or the body is not valid.", problem: true },
    404: NO_COLUMN,
    409: versionConflictResponse(columnSchema),
    415: NOT_JSON,
  },
} satisfies EndpointContract;

export const deleteColumnContract = {
  method: "delete",
  path: "/api/v1/columns/{columnId}",
  summary: "Delete a column",
  description: "The project's last `done` column cannot be deleted.",
  access: MANAGE,
  request: { params: columnParamsSchema },
  responses: {
    204: { description: "The column was deleted.", noContent: true },
    400: { description: "The path is not valid.", problem: true },
    404: NO_COLUMN,
    409: {
      description:
        "It is the last `done` column (code `last_done_column`), or the project is archived " +
        "(code `project_archived`).",
      problem: true,
    },
  },
} satisfies EndpointContract;
