import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";

import { pageSchema, paginationQuerySchema } from "./pagination";
import { taskParamsSchema } from "./tasks";

/** `user` comments are written by an account; `system` ones by Opanel itself (WT-06). */
export const commentKindSchema = z.enum(["user", "system"]).meta({ id: "CommentKind" });

export type CommentKind = z.infer<typeof commentKindSchema>;

/** Markdown, kept as written: not blank, up to 10 000 characters (WS-034). */
export const commentBodySchema = z
  .string()
  .max(10_000)
  .refine((body) => body.trim().length > 0, { message: "Write something." });

/** The account that wrote a comment, as a task shows its reporter. */
export const commentAuthorSchema = z
  .strictObject({ id: z.uuid(), name: z.string() })
  .meta({ id: "CommentAuthor" });

export const commentSchema = z
  .strictObject({
    id: z.uuid(),
    taskId: z.uuid(),
    kind: commentKindSchema,
    author: commentAuthorSchema
      .nullable()
      .meta({ description: "`null` only for a `system` comment." }),
    body: z.string().meta({ description: "Markdown." }),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "Comment" });

export type Comment = z.infer<typeof commentSchema>;

export const commentPageSchema = pageSchema(commentSchema).meta({ id: "CommentPage" });

export type CommentPage = z.infer<typeof commentPageSchema>;

export const commentQuerySchema = paginationQuerySchema;

export type CommentQuery = z.infer<typeof commentQuerySchema>;

export const createCommentRequestSchema = z
  .strictObject({ body: commentBodySchema })
  .meta({ id: "CreateCommentRequest" });

export type CreateCommentRequest = z.infer<typeof createCommentRequestSchema>;

const NO_TASK = { description: "There is no such task.", problem: true } as const;

export const listCommentsContract = {
  method: "get",
  path: "/api/v1/tasks/{taskId}/comments",
  summary: "List a task's comments",
  description: "Oldest first, with keyset pagination.",
  access: { kind: "permission", permission: "tasks:read" },
  request: { params: taskParamsSchema, query: commentQuerySchema },
  responses: {
    200: { description: "A page of comments.", schema: commentPageSchema },
    400: { description: "The path or the query string is not valid.", problem: true },
    404: NO_TASK,
  },
} satisfies EndpointContract;

export const createCommentContract = {
  method: "post",
  path: "/api/v1/tasks/{taskId}/comments",
  summary: "Comment on a task",
  description:
    "Adds a comment by the caller. Comments cannot be edited or deleted. The task's " +
    "`version` does not change.",
  access: { kind: "permission", permission: "comments:write" },
  request: { params: taskParamsSchema, body: createCommentRequestSchema },
  responses: {
    201: { description: "The new comment.", schema: commentSchema },
    400: { description: "The path or the body is not valid.", problem: true },
    404: NO_TASK,
    409: { description: "The project is archived (code `project_archived`).", problem: true },
    415: { description: "The body is not JSON.", problem: true },
  },
} satisfies EndpointContract;
