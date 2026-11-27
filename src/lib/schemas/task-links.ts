import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";
import { PAYLOAD_TOO_LARGE } from "@/lib/openapi/responses";

import { TASK_LINK_TYPES, type TaskLinkType } from "./bug-reports";
import { taskParamsSchema, taskRefSchema, taskSchema } from "./tasks";

// Adding and removing links between tasks (doc 0003 section 7, WT-09 decisions 3 and 6 to
// 8, WS-134). The types and the answer's `TaskLink` stay beside the task and bug-report
// schemas, which this file imports: moving them here would make an import cycle.

/** How a link reads from its task, by direction (doc 0003 section 7, WS-136, WS-137). */
export const LINK_READINGS = {
  blocks: { outgoing: "blocks", incoming: "is blocked by" },
  duplicates: { outgoing: "duplicates", incoming: "is duplicated by" },
  regression_of: { outgoing: "is a regression of", incoming: "has regression" },
  relates_to: { outgoing: "relates to", incoming: "relates to" },
} as const satisfies Record<TaskLinkType, Record<"outgoing" | "incoming", string>>;

/** At most this many links on one task, to tasks that are not deleted (WT-09 decision 3). */
export const MAX_TASK_LINKS = 100;

const linkFields = {
  type: z.enum(TASK_LINK_TYPES),
  direction: z.enum(["outgoing", "incoming"]).meta({
    description:
      "As the path task reads the link: `outgoing` means it blocks, duplicates, is a " +
      "regression of, or relates to the other task; `incoming` the reverse. For " +
      "`relates_to` both mean the same.",
  }),
  taskId: taskRefSchema,
};

export const taskLinkRequestSchema = z.strictObject(linkFields).meta({ id: "TaskLinkRequest" });

export type TaskLinkRequest = z.infer<typeof taskLinkRequestSchema>;

/** The same fields as query parameters, naming the link to remove (WT-09 decision 7). */
export const taskLinkQuerySchema = z.strictObject(linkFields);

const WRITE = { kind: "permission", permission: "tasks:write" } as const;
const NO_TASK = { description: "There is no such task.", problem: true } as const;
const REACH = {
  description: "The caller lacks `tasks:write`, or either task is in a project it may not reach.",
  problem: true,
} as const;

export const addTaskLinkContract = {
  method: "post",
  path: "/api/v1/tasks/{taskId}/links",
  summary: "Link two tasks",
  description:
    "Adds a link between the task and another, in any project the caller may reach. Both " +
    "tasks get a new `version`, a `linked` history entry and a `task.updated` event. " +
    "`relates_to` is stored once and reads `outgoing` from both tasks.",
  access: WRITE,
  request: { params: taskParamsSchema, body: taskLinkRequestSchema },
  responses: {
    200: { description: "The task, with its new links and version.", schema: taskSchema },
    400: {
      description:
        "The path or the body is not valid, or `taskId` names no task, a deleted one, or " +
        "the task itself.",
      problem: true,
    },
    403: REACH,
    404: NO_TASK,
    409: {
      description:
        "The link exists (code `link_exists`), either task has 100 links " +
        "(`too_many_links`), or either project is archived (`project_archived`).",
      problem: true,
    },
    413: PAYLOAD_TOO_LARGE,
    415: { description: "The body is not JSON.", problem: true },
  },
} satisfies EndpointContract;

export const removeTaskLinkContract = {
  method: "delete",
  path: "/api/v1/tasks/{taskId}/links",
  summary: "Remove a link between two tasks",
  description:
    "Removes the link the query names, as the path task reads it. Both tasks get a new " +
    "`version`, an `unlinked` history entry and a `task.updated` event.",
  access: WRITE,
  request: { params: taskParamsSchema, query: taskLinkQuerySchema },
  responses: {
    204: { description: "The link was removed.", noContent: true },
    400: {
      description:
        "The path or the query is not valid, or `taskId` names no task, a deleted one, or " +
        "the task itself.",
      problem: true,
    },
    403: REACH,
    404: { description: "There is no such task, or no such link.", problem: true },
    409: { description: "Either project is archived (code `project_archived`).", problem: true },
  },
} satisfies EndpointContract;
