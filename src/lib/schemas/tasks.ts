import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";
import { versionConflictResponse } from "@/lib/openapi/responses";

import { pageSchema, paginationQuerySchema } from "./pagination";
import { personSchema } from "./people";
import { projectParamsSchema } from "./projects";
import { versionSchema } from "./version";

export const taskTypeSchema = z.enum(["task", "bug", "story"]).meta({ id: "TaskType" });

export type TaskType = z.infer<typeof taskTypeSchema>;

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
  columnId: z.uuid(),
  assigneeTeam: teamRefSchema.nullable(),
  assignee: personSchema.nullable(),
  reporter: z.strictObject({ id: z.uuid(), name: z.string() }),
  version: z.int().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

/** A task in a list: everything but the description. */
export const taskSummarySchema = z.strictObject(taskFields).meta({ id: "TaskSummary" });

export type TaskSummary = z.infer<typeof taskSummarySchema>;

export const taskSchema = z
  .strictObject({ ...taskFields, description: z.string().meta({ description: "Markdown." }) })
  .meta({ id: "Task" });

export type Task = z.infer<typeof taskSchema>;

export const taskPageSchema = pageSchema(taskSummarySchema).meta({ id: "TaskPage" });

export type TaskPage = z.infer<typeof taskPageSchema>;

export const taskListQuerySchema = paginationQuerySchema.extend({
  columnId: z.uuid().optional().meta({ description: "Only the tasks of this column." }),
});

export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

export const createTaskRequestSchema = z
  .strictObject({
    title: taskTitleSchema,
    description: taskDescriptionSchema.optional(),
    type: taskTypeSchema.optional(),
    columnId: z
      .uuid()
      .optional()
      .meta({ description: "A column of the project. By default the first column." }),
    assigneeTeamId: z.uuid().optional(),
    assigneeAccountId: z.uuid().optional(),
  })
  .meta({ id: "CreateTaskRequest" });

export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

export const updateTaskRequestSchema = z
  .strictObject({
    title: taskTitleSchema.optional(),
    description: taskDescriptionSchema.optional(),
    type: taskTypeSchema.optional(),
    assigneeTeamId: z.uuid().nullable().optional().meta({ description: "`null` clears it." }),
    assigneeAccountId: z.uuid().nullable().optional().meta({ description: "`null` clears it." }),
    version: versionSchema,
  })
  .refine(
    (body) =>
      body.title !== undefined ||
      body.description !== undefined ||
      body.type !== undefined ||
      body.assigneeTeamId !== undefined ||
      body.assigneeAccountId !== undefined,
    { message: "Send at least one field to change." },
  )
  .meta({ id: "UpdateTaskRequest" });

export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;

export const moveTaskRequestSchema = z
  .strictObject({
    columnId: z.uuid().meta({ description: "A column of the task's project; may be its own." }),
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

export const listTasksContract = {
  method: "get",
  path: "/api/v1/projects/{projectId}/tasks",
  summary: "List a project's tasks",
  description:
    "Tasks in board order: by column, then by their place in the column, with keyset " +
    "pagination. Items leave out the description.",
  access: READ,
  request: { params: projectParamsSchema, query: taskListQuerySchema },
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
    "The task gets the next key of the project and goes to the end of its column. Only " +
    "active people can be assigned (code `account_inactive`).",
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
    409: versionConflictResponse(taskSchema),
    415: NOT_JSON,
  },
} satisfies EndpointContract;

export const moveTaskContract = {
  method: "post",
  path: "/api/v1/tasks/{taskId}/move",
  summary: "Move a task",
  description:
    "Moves the task to the end of a column of its project, or right after or right before a " +
    "task of that column. Send the `version` the move is based on.",
  access: WRITE,
  request: { params: taskParamsSchema, body: moveTaskRequestSchema },
  responses: {
    200: { description: "The task after the move.", schema: taskSchema },
    400: { description: "The path or the body is not valid.", problem: true },
    404: NO_TASK,
    409: versionConflictResponse(taskSchema),
    415: NOT_JSON,
  },
} satisfies EndpointContract;
