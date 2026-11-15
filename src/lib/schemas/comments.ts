import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";

import { pageSchema, paginationQuerySchema } from "./pagination";
import { taskParamsSchema } from "./tasks";

export const commentKindSchema = z.enum(["user"]).meta({ id: "CommentKind" });

export type CommentKind = z.infer<typeof commentKindSchema>;

export const commentAuthorSchema = z
  .strictObject({ id: z.uuid(), name: z.string() })
  .meta({ id: "CommentAuthor" });

export const commentSchema = z
  .strictObject({
    id: z.uuid(),
    taskId: z.uuid(),
    kind: commentKindSchema,
    author: commentAuthorSchema.nullable().meta({
      description: "`null` only for a comment that has no account; none exist yet.",
    }),
    body: z.string().meta({ description: "Markdown, as it was written." }),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "Comment" });

export type Comment = z.infer<typeof commentSchema>;

export const commentPageSchema = pageSchema(commentSchema).meta({ id: "CommentPage" });

export type CommentPage = z.infer<typeof commentPageSchema>;

/** Markdown, 1 to 10 000 characters, kept as written; blank text is not a comment. */
export const createCommentRequestSchema = z
  .strictObject({
    body: z
      .string()
      .max(10_000)
      .refine((value) => value.trim().length > 0, { message: "Write something." }),
  })
  .meta({ id: "CreateCommentRequest" });

export type CreateCommentRequest = z.infer<typeof createCommentRequestSchema>;

export const commentQuerySchema = paginationQuerySchema;

export type CommentQuery = z.infer<typeof commentQuerySchema>;

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
    "The author is the caller. A comment cannot be edited or deleted, and it does not change " +
    "the task's `version`.",
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
