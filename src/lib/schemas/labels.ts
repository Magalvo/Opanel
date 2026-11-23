import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";
import { PAYLOAD_TOO_LARGE, versionConflictResponse } from "@/lib/openapi/responses";

import { projectParamsSchema } from "./projects";
import { versionSchema } from "./version";

// Labels (doc 0003 section 4, WT-07 decisions 8 and 9, WS-107).

/** The fixed palette, stored by name; the UI gives each a light and a dark rendering. */
export const LABEL_COLOURS = [
  "gray",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "purple",
  "pink",
] as const;

export const labelColourSchema = z.enum(LABEL_COLOURS).meta({
  id: "LabelColour",
  description: "A colour of the fixed palette.",
});

export type LabelColour = z.infer<typeof labelColourSchema>;

/** At most this many labels in a project (`409 too_many_labels`). */
export const MAX_LABELS_PER_PROJECT = 200;

/** At most this many labels on a task. */
export const MAX_LABELS_PER_TASK = 20;

/** A label's name: trimmed, 1 to 40 characters, unique in its project ignoring case. */
export const labelNameSchema = z.string().trim().min(1).max(40);

export const labelSchema = z
  .strictObject({
    id: z.uuid(),
    projectId: z.uuid(),
    name: z.string(),
    colour: labelColourSchema,
    version: z.int().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Label" });

export type Label = z.infer<typeof labelSchema>;

/** A label as a task shows it. */
export const labelRefSchema = z
  .strictObject({ id: z.uuid(), name: z.string(), colour: labelColourSchema })
  .meta({ id: "LabelRef" });

export type LabelRef = z.infer<typeof labelRefSchema>;

/** Every label of a project, by name. Never paginated: at most 200. */
export const labelListSchema = z
  .strictObject({ items: z.array(labelSchema), nextCursor: z.null() })
  .meta({ id: "LabelList" });

export type LabelList = z.infer<typeof labelListSchema>;

export const createLabelRequestSchema = z
  .strictObject({
    name: labelNameSchema,
    colour: labelColourSchema.default("gray").meta({ description: "By default `gray`." }),
  })
  .meta({ id: "CreateLabelRequest" });

export type CreateLabelRequest = z.infer<typeof createLabelRequestSchema>;

export const updateLabelRequestSchema = z
  .strictObject({
    name: labelNameSchema.optional(),
    colour: labelColourSchema.optional(),
    version: versionSchema,
  })
  .refine((body) => body.name !== undefined || body.colour !== undefined, {
    message: "Send name, colour or both.",
  })
  .meta({ id: "UpdateLabelRequest" });

export type UpdateLabelRequest = z.infer<typeof updateLabelRequestSchema>;

export const labelParamsSchema = z.strictObject({ labelId: z.uuid() });

const NO_LABEL = { description: "There is no such label.", problem: true } as const;
const NOT_JSON = { description: "The body is not JSON.", problem: true } as const;
const MANAGE = { kind: "permission", permission: "labels:manage" } as const;

export const listLabelsContract = {
  method: "get",
  path: "/api/v1/projects/{projectId}/labels",
  summary: "List a project's labels",
  description: "Every label of the project, by name, in one response.",
  access: { kind: "permission", permission: "tasks:read" },
  request: { params: projectParamsSchema },
  responses: {
    200: { description: "The labels.", schema: labelListSchema },
    400: { description: "The path is not valid.", problem: true },
    404: { description: "There is no such project.", problem: true },
  },
} satisfies EndpointContract;

export const createLabelContract = {
  method: "post",
  path: "/api/v1/projects/{projectId}/labels",
  summary: "Create a label",
  description: `A project has at most ${String(MAX_LABELS_PER_PROJECT)} labels.`,
  access: { kind: "permission", permission: "labels:write" },
  request: { params: projectParamsSchema, body: createLabelRequestSchema },
  responses: {
    201: { description: "The new label.", schema: labelSchema },
    400: { description: "The path or the body is not valid.", problem: true },
    404: { description: "There is no such project.", problem: true },
    409: {
      description:
        "Another label of the project has the name, ignoring case (code `label_name_taken`), " +
        "the project has its maximum of labels (code `too_many_labels`), or it is archived " +
        "(code `project_archived`).",
      problem: true,
    },
    413: PAYLOAD_TOO_LARGE,
    415: NOT_JSON,
  },
} satisfies EndpointContract;

export const updateLabelContract = {
  method: "patch",
  path: "/api/v1/labels/{labelId}",
  summary: "Rename or recolour a label",
  description:
    "Send the `version` the change is based on. Tasks show the change at once; their " +
    "history and versions do not change.",
  access: MANAGE,
  request: { params: labelParamsSchema, body: updateLabelRequestSchema },
  responses: {
    200: { description: "The label after the change.", schema: labelSchema },
    400: { description: "The path or the body is not valid.", problem: true },
    404: NO_LABEL,
    409: versionConflictResponse(labelSchema, ["label_name_taken", "project_archived"]),
    413: PAYLOAD_TOO_LARGE,
    415: NOT_JSON,
  },
} satisfies EndpointContract;

export const deleteLabelContract = {
  method: "delete",
  path: "/api/v1/labels/{labelId}",
  summary: "Delete a label",
  description: "Removes the label from every task that has it, each change in the task's history.",
  access: MANAGE,
  request: { params: labelParamsSchema },
  responses: {
    204: { description: "The label was deleted.", noContent: true },
    400: { description: "The path is not valid.", problem: true },
    404: NO_LABEL,
    409: { description: "The project is archived (code `project_archived`).", problem: true },
  },
} satisfies EndpointContract;
