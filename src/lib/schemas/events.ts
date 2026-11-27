import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";
import { BAD_PATH } from "@/lib/openapi/responses";

import { projectParamsSchema } from "./projects";

/**
 * The events of a project (canonical doc 0002 section 3, as amended by WT-04 decision 1;
 * WS-045). Small and thin: identifiers and a version, never an entity's content, so the
 * read endpoints keep enforcing permissions and a payload stays far below the 8 000 bytes
 * NOTIFY allows.
 */

/** The PostgreSQL channel every event is sent on. The hub routes them by `projectId`. */
export const EVENTS_CHANNEL = "opanel_events";

const common = {
  id: z.uuid().meta({ description: "This event's own id." }),
  projectId: z.uuid(),
  entityId: z.uuid(),
  actorAccountId: z.uuid().meta({ description: "The account whose write sent the event." }),
  at: z.iso.datetime().meta({ description: "When the event was sent." }),
};

/** The entity's version after the write. */
const version = z.int().min(1);

function taskEvent<const Type extends string>(type: Type) {
  return z.strictObject({ ...common, type: z.literal(type), entity: z.literal("task"), version });
}

const commentCreated = z.strictObject({
  ...common,
  type: z.literal("comment.created"),
  entity: z.literal("comment"),
  taskId: z.uuid().meta({ description: "The task the comment belongs to." }),
  version: z.null().meta({ description: "Comments have no version." }),
});

const columnChanged = z.strictObject({
  ...common,
  type: z.literal("column.changed"),
  entity: z.literal("column"),
  version: version.nullable().meta({ description: "`null` when the column was deleted." }),
});

const labelChanged = z.strictObject({
  ...common,
  type: z.literal("label.changed"),
  entity: z.literal("label"),
  version: version.nullable().meta({ description: "`null` when the label was deleted." }),
});

const epicChanged = z.strictObject({
  ...common,
  type: z.literal("epic.changed"),
  entity: z.literal("epic"),
  version,
});

const sprintChanged = z.strictObject({
  ...common,
  type: z.literal("sprint.changed"),
  entity: z.literal("sprint"),
  version: version.nullable().meta({ description: "`null` when the sprint was deleted." }),
});

const projectChanged = z.strictObject({
  ...common,
  type: z.literal("project.changed"),
  entity: z.literal("project"),
  version,
});

export const projectEventSchema = z
  .discriminatedUnion("type", [
    taskEvent("task.created"),
    taskEvent("task.updated"),
    taskEvent("task.moved"),
    taskEvent("task.deleted"),
    taskEvent("task.restored"),
    commentCreated,
    columnChanged,
    labelChanged,
    epicChanged,
    sprintChanged,
    projectChanged,
  ])
  .refine((event) => event.type !== "project.changed" || event.entityId === event.projectId, {
    message: "A project event is about its own project.",
    path: ["entityId"],
  })
  .meta({ id: "ProjectEvent" });

export type ProjectEvent = z.infer<typeof projectEventSchema>;

export type ProjectEventType = ProjectEvent["type"];

export const PROJECT_EVENT_TYPES: readonly ProjectEventType[] = [
  "task.created",
  "task.updated",
  "task.moved",
  "task.deleted",
  "task.restored",
  "comment.created",
  "column.changed",
  "epic.changed",
  "label.changed",
  "sprint.changed",
  "project.changed",
];

export const projectEventsContract = {
  method: "get",
  path: "/api/v1/projects/{projectId}/events",
  summary: "Stream a project's events",
  description:
    "Server-Sent Events (WS-047): every change to the project's tasks, comments, columns, " +
    "epics, labels, sprints and the project itself, as it is committed. Each event says what changed, not " +
    "how: read the entity again through its endpoint. Delivery is at most once; after a " +
    "reconnection, reload what you show. At most 10 streams per account and app process.",
  access: { kind: "permission", permission: "tasks:read" },
  request: { params: projectParamsSchema },
  responses: {
    200: {
      description:
        "The stream. Each event is a frame `event: <type>` followed by `data: <the event as " +
        "JSON>`. Lines starting with `:` are comments: `: connected` first, then `: heartbeat` " +
        "every 25 seconds. `retry: 3000` asks the browser to wait 3 seconds before " +
        "reconnecting. The stream ends when the session is no longer valid or events may " +
        "have been missed.",
      eventStream: projectEventSchema,
    },
    400: BAD_PATH,
    404: { description: "There is no such project.", problem: true },
    429: {
      description:
        "The account has too many open streams (code `too_many_streams`); `Retry-After` says " +
        "when to try again.",
      problem: true,
    },
  },
} satisfies EndpointContract;
