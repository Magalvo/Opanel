import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";

import { accountRefSchema } from "./account-ref";
import { commentSchema } from "./comments";
import { pageSchema, paginationQuerySchema } from "./pagination";
import { taskParamsSchema } from "./tasks";

// A task's activity: its history and its comments in one list (WS-117, WT-08 decision 10).

/** Something an entry names by id, with its name now; `null` once it no longer exists. */
export const namedRefSchema = z
  .strictObject({
    id: z.uuid(),
    name: z.string().nullable().meta({ description: "`null` when it no longer exists." }),
  })
  .meta({ id: "NamedRef" });

export type NamedRef = z.infer<typeof namedRefSchema>;

/** The history's event types the activity shows: `commented` is the comment itself. */
export const ACTIVITY_EVENT_TYPES = [
  "created",
  "field_changed",
  "moved",
  "deleted",
  "restored",
  "reported_again",
] as const;

const VALUES_DESCRIPTION =
  "Depends on `type` and `field`. `field_changed`: `assigneeAccountId` is an `AccountRef`, " +
  "`assigneeTeamId` and `epicId` are `NamedRef`s (an epic's name is its title), `labels` " +
  "is a list of `{ id, name }`, and every other field is its value. `moved`: " +
  "`{ column: NamedRef | null }`, `null` for the backlog. `created`: the new task's fields, " +
  "with `column` as for `moved`. `reported_again`: `{ reportId, occurrences }`. `null` " +
  "when there is none.";

export const activityEventSchema = z
  .strictObject({
    kind: z.literal("event"),
    id: z.string().meta({ description: "The history entry's id." }),
    type: z.enum(ACTIVITY_EVENT_TYPES),
    field: z.string().nullable().meta({ description: "The changed field, for `field_changed`." }),
    oldValue: z.unknown().meta({ description: VALUES_DESCRIPTION }),
    newValue: z.unknown().meta({ description: VALUES_DESCRIPTION }),
    actor: accountRefSchema
      .nullable()
      .meta({ description: "Who acted; `null` when no account did." }),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "TaskActivityEvent" });

export type ActivityEvent = z.infer<typeof activityEventSchema>;

export const activityCommentSchema = z
  .strictObject({ kind: z.literal("comment"), comment: commentSchema })
  .meta({ id: "TaskActivityComment" });

export const activityItemSchema = z.discriminatedUnion("kind", [
  activityCommentSchema,
  activityEventSchema,
]);

export type ActivityItem = z.infer<typeof activityItemSchema>;

export const activityPageSchema = pageSchema(activityItemSchema).meta({
  id: "TaskActivityPage",
});

export type ActivityPage = z.infer<typeof activityPageSchema>;

export const activityQuerySchema = paginationQuerySchema;

export type ActivityQuery = z.infer<typeof activityQuerySchema>;

export const listActivityContract = {
  method: "get",
  path: "/api/v1/tasks/{taskId}/activity",
  summary: "List a task's activity",
  description:
    "The task's history and its comments, oldest first, with keyset pagination. Accounts, " +
    "teams, epics and columns are named as they are now.",
  access: { kind: "permission", permission: "tasks:read" },
  request: { params: taskParamsSchema, query: activityQuerySchema },
  responses: {
    200: { description: "A page of the task's activity.", schema: activityPageSchema },
    400: { description: "The path or the query string is not valid.", problem: true },
    404: { description: "There is no such task.", problem: true },
  },
} satisfies EndpointContract;
