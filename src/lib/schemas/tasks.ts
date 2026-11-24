import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";
import { PAYLOAD_TOO_LARGE, versionConflictResponse } from "@/lib/openapi/responses";

import { accountKindSchema, accountRefSchema } from "./account-ref";
import { severitySchema, TASK_LINK_TYPES } from "./bug-reports";
import { columnCategorySchema } from "./columns";
import { calendarDateSchema } from "./dates";
import { epicRefSchema } from "./epics";
import { labelRefSchema, MAX_LABELS_PER_TASK } from "./labels";
import { pageSchema, paginationQuerySchema } from "./pagination";
import { personSchema } from "./people";
import { projectKeySchema, projectParamsSchema, projectRefSchema } from "./projects";
import { versionSchema } from "./version";

export const taskTypeSchema = z.enum(["task", "bug", "story"]).meta({ id: "TaskType" });

export type TaskType = z.infer<typeof taskTypeSchema>;

/** A task's priority (doc 0003 section 4, WS-102); `none` by default. */
export const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export const prioritySchema = z.enum(PRIORITIES).meta({ id: "Priority" });

export type Priority = z.infer<typeof prioritySchema>;

/** Trimmed, 1 to 200 characters. */
export const taskTitleSchema = z.string().trim().min(1).max(200);

/** Markdown, up to 50 000 characters, kept as written. */
export const taskDescriptionSchema = z.string().max(50_000);

/** `OPA-12`: the project's key, a dash and the task's number (doc 0003 section 2). */
export const taskKeySchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,8}$/, "A task key such as OPA-12.");

export const taskRefSchema = z
  .union([z.uuid(), taskKeySchema])
  .meta({ description: "The task's id or its key, such as `OPA-12`." });

export const taskParamsSchema = z.strictObject({ taskId: taskRefSchema });

export const teamRefSchema = z
  .strictObject({ id: z.uuid(), name: z.string() })
  .meta({ id: "TeamRef" });

const taskFields = {
  id: z.uuid(),
  key: z.string().meta({ description: "Never changes and is never reused." }),
  number: z.int().min(1),
  projectId: z.uuid(),
  type: taskTypeSchema,
  title: z.string(),
  columnId: z
    .uuid()
    .nullable()
    .meta({ description: "The task's column; `null` when the task is in the backlog." }),
  assigneeTeam: teamRefSchema.nullable(),
  assignee: personSchema.nullable(),
  epic: epicRefSchema.nullable(),
  reporter: accountRefSchema,
  // The bug fields (WT-06 decision 1, WS-088): only the triage pipeline writes the last three.
  severity: severitySchema.nullable().meta({ description: "Bugs only." }),
  fingerprint: z.string().nullable().meta({
    description: "Set by the triage pipeline from the agent's report; read-only.",
  }),
  occurrences: z.int().min(0).meta({
    description: "How many bug reports this task stands for; read-only.",
  }),
  lastReportedAt: z.iso.datetime().nullable().meta({ description: "Read-only." }),
  priority: prioritySchema,
  dueDate: calendarDateSchema.nullable().meta({ description: "A calendar date, or `null`." }),
  labels: z.array(labelRefSchema).meta({ description: "The task's labels, by name." }),
  version: z.int().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso
    .datetime()
    .nullable()
    .meta({ description: "Set only on deleted tasks, which only the deleted list shows." }),
};

/** A link from or to another task (doc 0003 section 7, WS-090). WT-09 adds types. */
export const taskLinkSchema = z
  .strictObject({
    type: z.enum(TASK_LINK_TYPES),
    direction: z.enum(["outgoing", "incoming"]).meta({
      description:
        "`outgoing`: this task is a regression of the other; `incoming`: the other is a " +
        "regression of this one.",
    }),
    task: z.strictObject({ id: z.uuid(), key: z.string(), title: z.string() }),
  })
  .meta({ id: "TaskLink" });

export type TaskLink = z.infer<typeof taskLinkSchema>;

/** A task in a list: everything but the description. */
export const taskSummarySchema = z.strictObject(taskFields).meta({ id: "TaskSummary" });

export type TaskSummary = z.infer<typeof taskSummarySchema>;

export const taskSchema = z
  .strictObject({
    ...taskFields,
    description: z.string().meta({ description: "Markdown." }),
    links: z.array(taskLinkSchema).meta({
      description: "Links to tasks that are not deleted. Lists of tasks leave them out.",
    }),
  })
  .meta({ id: "Task" });

export type Task = z.infer<typeof taskSchema>;

export const taskPageSchema = pageSchema(taskSummarySchema).meta({ id: "TaskPage" });

export type TaskPage = z.infer<typeof taskPageSchema>;

/** At most this many values of one filter (WT-08 decision 1). */
export const MAX_FILTER_VALUES = 20;

/**
 * A filter given once or repeated (`priority=high&priority=urgent`), read as an array: a
 * task matches any of its values (WS-116 section 2).
 */
function oneOrMany<Value extends z.ZodType>(value: Value, description: string) {
  return z
    .union([value, z.array(value).min(1).max(MAX_FILTER_VALUES)])
    .transform((given): z.output<Value>[] =>
      Array.isArray(given) ? (given as z.output<Value>[]) : [given as z.output<Value>],
    )
    .optional()
    .meta({ description: `${description} Repeat it for any of several values.` });
}

const noneOrId = z.union([z.uuid(), z.literal("none")]);

/**
 * The filters every task list takes (WT-08 decision 1, WS-116). Different filters must all
 * hold; a filter only leaves tasks out.
 */
export const taskFilterShape = {
  q: z
    .string()
    .trim()
    .min(1, { abort: true })
    .max(200)
    .refine((text) => /[\p{L}\p{N}]/u.test(text), { message: "Use at least one letter or digit." })
    .optional()
    .meta({
      description:
        "Text search: a task key such as `OPA-12` finds that task; otherwise every word must " +
        "be a word of the title or description, the last one as a prefix.",
    }),
  type: oneOrMany(taskTypeSchema, "Only tasks of this type."),
  category: oneOrMany(columnCategorySchema, "Only tasks in a column of this category."),
  done: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional()
    .meta({ description: "`true`: in a `done` column; `false`: anywhere else, the backlog too." }),
  assigneeTeamId: oneOrMany(noneOrId, "Only tasks assigned to this team; `none` for no team."),
  assigneeAccountId: oneOrMany(
    z.union([z.uuid(), z.enum(["none", "me"])]),
    "Only tasks assigned to this person; `none` for nobody, `me` for the caller.",
  ),
  reporterAccountId: oneOrMany(
    z.union([z.uuid(), z.literal("me")]),
    "Only tasks reported by this account; `me` for the caller.",
  ),
  reporterKind: accountKindSchema
    .optional()
    .meta({ description: "Only tasks reported by people (`human`) or by agents (`agent`)." }),
  labelId: oneOrMany(z.uuid(), "Only tasks with this label of the project."),
  epicId: oneOrMany(noneOrId, "Only tasks of this epic of the project; `none` for no epic."),
  priority: oneOrMany(prioritySchema, "Only tasks of this priority."),
  severity: oneOrMany(severitySchema, "Only bugs of this severity."),
  dueFrom: calendarDateSchema
    .optional()
    .meta({ description: "Only tasks due on this date or later." }),
  dueTo: calendarDateSchema
    .optional()
    .meta({ description: "Only tasks due on this date or earlier." }),
};

export type TaskFilter = z.output<z.ZodObject<typeof taskFilterShape>>;

function dueInOrder(query: { dueFrom?: string | undefined; dueTo?: string | undefined }): boolean {
  return query.dueFrom === undefined || query.dueTo === undefined || query.dueFrom <= query.dueTo;
}

const DUE_ORDER = { path: ["dueTo"], message: "Not before dueFrom." };

export const taskListQuerySchema = paginationQuerySchema
  .extend({
    ...taskFilterShape,
    columnId: oneOrMany(
      z.union([z.uuid(), z.literal("backlog")]),
      "Only the tasks of this column; `backlog` for tasks with none, which only the deleted " +
        "list shows.",
    ),
    deleted: z
      .enum(["true", "false"])
      .optional()
      .meta({
        description:
          "`true` lists only deleted tasks, and needs the `tasks:delete_any` permission (Managers " +
          "and Admins).",
      }),
  })
  .refine(dueInOrder, DUE_ORDER);

export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

/** The backlog's query (WS-101): a page and the filters (WS-116), no column. */
export const backlogQuerySchema = paginationQuerySchema
  .extend(taskFilterShape)
  .refine(dueInOrder, DUE_ORDER);

export type BacklogQuery = z.infer<typeof backlogQuerySchema>;

/** The orders of the list across projects (WT-08 decision 4, WS-118 section 5). */
export const TASK_SORTS = ["key", "title", "priority", "dueDate", "created", "updated"] as const;

export type TaskSortField = (typeof TASK_SORTS)[number];

export const taskSortSchema = z
  .enum([...TASK_SORTS, ...TASK_SORTS.map((field) => `-${field}` as const)])
  .meta({
    description:
      "A field, ascending, or `-` and a field, descending. Tasks with no due date come last " +
      "either way.",
  });

export type TaskSort = z.infer<typeof taskSortSchema>;

/** The list across projects (WS-118): a page, the filters, the projects and the order. */
export const allTasksQuerySchema = paginationQuerySchema
  .extend({
    ...taskFilterShape,
    projectId: oneOrMany(
      projectRefSchema,
      "Only the tasks of this project, by id or key; it may be archived.",
    ),
    sort: taskSortSchema.default("-updated"),
  })
  .refine(dueInOrder, DUE_ORDER);

export type AllTasksQuery = z.infer<typeof allTasksQuerySchema>;

/** A task in the list across projects: its summary, its project and its column (WS-118). */
export const taskListItemSchema = taskSummarySchema
  .extend({
    project: z
      .strictObject({ id: z.uuid(), key: projectKeySchema, name: z.string() })
      .meta({ id: "TaskProject" }),
    column: z
      .strictObject({ id: z.uuid(), name: z.string(), category: columnCategorySchema })
      .nullable()
      .meta({ id: "TaskColumn", description: "`null` when the task is in the backlog." }),
  })
  .meta({ id: "TaskListItem" });

export type TaskListItem = z.infer<typeof taskListItemSchema>;

export const taskListItemPageSchema = pageSchema(taskListItemSchema).meta({
  id: "TaskListItemPage",
});

export type TaskListItemPage = z.infer<typeof taskListItemPageSchema>;

/**
 * A task's whole set of labels (WS-107): replaces the previous set. Sending it needs
 * `labels:write` as well as `tasks:write`.
 */
const labelIdsSchema = z
  .array(z.uuid())
  .max(MAX_LABELS_PER_TASK)
  .refine((ids) => new Set(ids).size === ids.length, { message: "A label is listed twice." })
  .meta({
    description:
      "Labels of the project; the whole set, replacing the previous one. Needs the " +
      "`labels:write` permission as well.",
  });

/** The message of a severity sent for a task that is not a bug (WS-088). */
export const ONLY_BUGS = "Only a bug has a severity.";

/**
 * The fields of a task creation other than `labelIds`, and the rule they follow. Exported
 * apart so that a client with no `labels:write`, the MCP server, can build its input
 * without `labelIds` and with the same rule: Zod cannot `omit` from a refined schema
 * (WS-107 section 7).
 */
export const createTaskFields = {
  title: taskTitleSchema,
  description: taskDescriptionSchema.optional(),
  type: taskTypeSchema.optional(),
  columnId: z
    .uuid()
    .nullable()
    .optional()
    .meta({
      description:
        "A column of the project, or `null` for the end of the backlog. By default the first " +
        "column.",
    }),
  assigneeTeamId: z.uuid().optional(),
  assigneeAccountId: z.uuid().optional(),
  epicId: z.uuid().optional().meta({ description: "An epic of the project." }),
  severity: severitySchema.optional().meta({ description: 'Only with `type: "bug"`.' }),
  priority: prioritySchema.optional().meta({ description: "By default `none`." }),
  dueDate: calendarDateSchema.optional().meta({ description: "By default none." }),
};

/** A creation's rule: only a bug has a severity. */
export function withCreateTaskRules<
  S extends z.ZodType<{ type?: string | undefined; severity?: unknown }>,
>(schema: S): S {
  return schema.refine((body) => body.severity === undefined || body.type === "bug", {
    message: ONLY_BUGS,
    path: ["severity"],
  });
}

export const createTaskRequestSchema = withCreateTaskRules(
  z.strictObject({ ...createTaskFields, labelIds: labelIdsSchema.optional() }),
).meta({ id: "CreateTaskRequest" });

export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

/** The fields of a task update other than `labelIds`; see `createTaskFields`. */
export const updateTaskFields = {
  title: taskTitleSchema.optional(),
  description: taskDescriptionSchema.optional(),
  type: taskTypeSchema.optional(),
  assigneeTeamId: z.uuid().nullable().optional().meta({ description: "`null` clears it." }),
  assigneeAccountId: z.uuid().nullable().optional().meta({ description: "`null` clears it." }),
  epicId: z
    .uuid()
    .nullable()
    .optional()
    .meta({ description: "An epic of the project; `null` takes the task out of its epic." }),
  severity: severitySchema.nullable().optional().meta({
    description: "Bugs only; `null` clears it. A task that stops being a bug loses it.",
  }),
  priority: prioritySchema.optional(),
  dueDate: calendarDateSchema.nullable().optional().meta({ description: "`null` clears it." }),
  version: versionSchema,
};

/** Every field an update may change; `version` only says what it is based on. */
const UPDATABLE = [
  "title",
  "description",
  "type",
  "assigneeTeamId",
  "assigneeAccountId",
  "epicId",
  "severity",
  "priority",
  "dueDate",
  "labelIds",
] as const;

/** An update's rule: it changes at least one field. */
export function withUpdateTaskRules<S extends z.ZodType<Partial<Record<string, unknown>>>>(
  schema: S,
): S {
  return schema.refine((body) => UPDATABLE.some((field) => body[field] !== undefined), {
    message: "Send at least one field to change.",
  });
}

export const updateTaskRequestSchema = withUpdateTaskRules(
  z.strictObject({ ...updateTaskFields, labelIds: labelIdsSchema.optional() }),
).meta({ id: "UpdateTaskRequest" });

export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;

export const moveTaskRequestSchema = z
  .strictObject({
    columnId: z.uuid().nullable().meta({
      description:
        "A column of the task's project, may be its own; `null` for the project's backlog.",
    }),
    afterTaskId: z.uuid().optional().meta({ description: "Place the task right after this one." }),
    beforeTaskId: z
      .uuid()
      .optional()
      .meta({ description: "Or right before this one. Without either, at the end." }),
    version: versionSchema,
  })
  .refine((body) => body.afterTaskId === undefined || body.beforeTaskId === undefined, {
    message: "Send afterTaskId or beforeTaskId, not both.",
    path: ["beforeTaskId"],
  })
  .meta({ id: "MoveTaskRequest" });

export type MoveTaskRequest = z.infer<typeof moveTaskRequestSchema>;

const READ = { kind: "permission", permission: "tasks:read" } as const;
const WRITE = { kind: "permission", permission: "tasks:write" } as const;
const NO_TASK = { description: "There is no such task.", problem: true } as const;
const NOT_JSON = { description: "The body is not JSON.", problem: true } as const;

const FILTERS_DESCRIPTION =
  "Filters only leave tasks out: a repeated parameter keeps tasks matching any of its " +
  "values, and different parameters must all hold. A column, label or epic of another " +
  "project is a `400`.";

export const listTasksContract = {
  method: "get",
  path: "/api/v1/projects/{projectId}/tasks",
  summary: "List a project's tasks",
  description:
    "Tasks in board order: by column, then by their place in the column, with keyset " +
    "pagination. Items leave out the description. Tasks in the backlog are not on the " +
    "board and are listed only with `deleted=true`, after every column's. " +
    FILTERS_DESCRIPTION,
  access: READ,
  request: { params: projectParamsSchema, query: taskListQuerySchema },
  responses: {
    200: { description: "A page of tasks.", schema: taskPageSchema },
    400: { description: "The path or the query string is not valid.", problem: true },
    404: { description: "There is no such project.", problem: true },
  },
} satisfies EndpointContract;

export const listAllTasksContract = {
  method: "get",
  path: "/api/v1/tasks",
  summary: "List tasks across projects",
  description:
    "The live tasks of every project the caller may read, on the board and in the backlog, " +
    "leaving out archived projects unless `projectId` names them, in the order `sort` " +
    "gives, with keyset pagination. A task changed while you page may move to a page you " +
    "have already read. Items leave out the description. " +
    FILTERS_DESCRIPTION,
  access: READ,
  request: { query: allTasksQuerySchema },
  responses: {
    200: { description: "A page of tasks.", schema: taskListItemPageSchema },
    400: { description: "The query string is not valid.", problem: true },
    404: { description: "There is no such project.", problem: true },
  },
} satisfies EndpointContract;

export const listBacklogContract = {
  method: "get",
  path: "/api/v1/projects/{projectId}/backlog",
  summary: "List a project's backlog",
  description:
    "The tasks that are not on the board, in the backlog's order (the team's ranking), with " +
    "keyset pagination. Items leave out the description. " +
    FILTERS_DESCRIPTION,
  access: READ,
  request: { params: projectParamsSchema, query: backlogQuerySchema },
  responses: {
    200: { description: "A page of tasks.", schema: taskPageSchema },
    400: { description: "The path or the query string is not valid.", problem: true },
    404: { description: "There is no such project.", problem: true },
  },
} satisfies EndpointContract;

export const createTaskContract = {
  method: "post",
  path: "/api/v1/projects/{projectId}/tasks",
  summary: "Create a task",
  description:
    "The task gets the next key of the project and goes to the end of its column, or of " +
    "the backlog with `columnId: null`. Only active people can be assigned (code " +
    "`account_inactive`).",
  access: WRITE,
  request: { params: projectParamsSchema, body: createTaskRequestSchema },
  responses: {
    201: { description: "The new task.", schema: taskSchema },
    400: { description: "The path or the body is not valid.", problem: true },
    404: { description: "There is no such project.", problem: true },
    409: {
      description:
        "The project is archived (code `project_archived`) or the person is deactivated " +
        "(code `account_inactive`).",
      problem: true,
    },
    413: PAYLOAD_TOO_LARGE,
    415: NOT_JSON,
  },
} satisfies EndpointContract;

export const getTaskContract = {
  method: "get",
  path: "/api/v1/tasks/{taskId}",
  summary: "Get a task",
  access: READ,
  request: { params: taskParamsSchema },
  responses: {
    200: { description: "The task.", schema: taskSchema },
    400: { description: "The path is not valid.", problem: true },
    404: NO_TASK,
  },
} satisfies EndpointContract;

export const updateTaskContract = {
  method: "patch",
  path: "/api/v1/tasks/{taskId}",
  summary: "Edit or assign a task",
  description:
    "Send the `version` the change is based on. Moving a task between columns is its own " +
    "operation.",
  access: WRITE,
  request: { params: taskParamsSchema, body: updateTaskRequestSchema },
  responses: {
    200: { description: "The task after the change.", schema: taskSchema },
    400: { description: "The path or the body is not valid.", problem: true },
    404: NO_TASK,
    409: versionConflictResponse(taskSchema, ["project_archived", "account_inactive"]),
    413: PAYLOAD_TOO_LARGE,
    415: NOT_JSON,
  },
} satisfies EndpointContract;

export const moveTaskContract = {
  method: "post",
  path: "/api/v1/tasks/{taskId}/move",
  summary: "Move a task",
  description:
    "Moves the task to the end of a column of its project, or right after or right before a " +
    "task of that column; with `columnId: null`, the same within the project's backlog. " +
    "Send the `version` the move is based on.",
  access: WRITE,
  request: { params: taskParamsSchema, body: moveTaskRequestSchema },
  responses: {
    200: { description: "The task after the move.", schema: taskSchema },
    400: { description: "The path or the body is not valid.", problem: true },
    404: NO_TASK,
    409: versionConflictResponse(taskSchema, ["project_archived"]),
    413: PAYLOAD_TOO_LARGE,
    415: NOT_JSON,
  },
} satisfies EndpointContract;

export const deleteTaskContract = {
  method: "delete",
  path: "/api/v1/tasks/{taskId}",
  summary: "Delete a task",
  description:
    "A soft delete: the task leaves every view and can be restored by a Manager or Admin. " +
    "Members may delete only tasks they reported; Managers and Admins any task.",
  access: { kind: "permission", permission: "tasks:delete_own" },
  request: { params: taskParamsSchema },
  responses: {
    204: { description: "The task was deleted.", noContent: true },
    400: { description: "The path is not valid.", problem: true },
    403: {
      description: "The actor may not delete this task, or lacks the permission.",
      problem: true,
    },
    404: NO_TASK,
    409: { description: "The project is archived (code `project_archived`).", problem: true },
  },
} satisfies EndpointContract;

export const restoreTaskContract = {
  method: "post",
  path: "/api/v1/tasks/{taskId}/restore",
  summary: "Restore a deleted task",
  description:
    "Brings the task back to its column and place, with its key. Restoring a task that is " +
    "not deleted changes nothing.",
  access: { kind: "permission", permission: "tasks:delete_any" },
  request: { params: taskParamsSchema },
  responses: {
    200: { description: "The task.", schema: taskSchema },
    400: { description: "The path is not valid.", problem: true },
    404: NO_TASK,
    409: { description: "The project is archived (code `project_archived`).", problem: true },
  },
} satisfies EndpointContract;
