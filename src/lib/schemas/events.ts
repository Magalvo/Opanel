import { z } from "zod";

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

const epicChanged = z.strictObject({
  ...common,
  type: z.literal("epic.changed"),
  entity: z.literal("epic"),
  version,
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
    epicChanged,
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
  "project.changed",
];
