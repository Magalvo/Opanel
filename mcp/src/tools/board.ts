import { z } from "zod";

import { columnListSchema, columnSchema } from "@/lib/schemas/columns";
import { MAX_PAGE_LIMIT } from "@/lib/schemas/pagination";
import { projectParamsSchema } from "@/lib/schemas/projects";
import {
  type TaskPage,
  taskPageSchema,
  type TaskSummary,
  taskSummarySchema,
} from "@/lib/schemas/tasks";

import type { ApiClient, ApiResult } from "../api";
import { messageError, toolError } from "../errors";
import type { ToolDefinition } from "../tools";
import { count, DATA_NOT_INSTRUCTIONS, query, quote, READ_ONLY, readResult } from "./results";

// `opanel_get_board`: every column of a project with all its tasks, as the web app loads
// the board (doc 0005 section 4, WS-100).

const NAME = "opanel_get_board";

/** A guard against a runaway load: 100 pages of 100 tasks. */
export const MAX_BOARD_PAGES = 100;

export const boardSchema = z.strictObject({
  columns: z.array(columnSchema.extend({ tasks: z.array(taskSummarySchema) })),
});

export type Board = z.infer<typeof boardSchema>;

function summary(projectId: string, board: Board): string {
  const columns = board.columns
    .map((column) => `${quote(column.name)} ${String(column.tasks.length)}`)
    .join(", ");
  const total = board.columns.reduce((sum, column) => sum + column.tasks.length, 0);
  return `Board of ${projectId}: ${columns} (${count(total, "task", "tasks")}).`;
}

const TOO_MANY = "too_many";

/** Every task of the project, in board order, following each page as the web app does. */
async function loadTasks(
  api: ApiClient,
  project: string,
): Promise<ApiResult<TaskSummary[]> | typeof TOO_MANY> {
  const tasks: TaskSummary[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < MAX_BOARD_PAGES; pages += 1) {
    const path = `${project}/tasks${query({ limit: MAX_PAGE_LIMIT, cursor })}`;
    const page: ApiResult<TaskPage> = await api.get(path, taskPageSchema);
    if (!page.ok) return page;
    tasks.push(...page.value.items);
    if (page.value.nextCursor === null) return { ok: true, value: tasks };
    cursor = page.value.nextCursor;
  }
  return TOO_MANY;
}

export const getBoard: ToolDefinition = {
  name: NAME,
  permissions: ["projects:read", "tasks:read"],
  register(server, { api, redact }) {
    server.registerTool(
      NAME,
      {
        title: "Get an Opanel board",
        description:
          "Answers a project's whole board: every column in board order, each with all its " +
          "tasks in board order (tasks leave out the description; opanel_get_task has it). " +
          "projectId is the project's id or key, such as OPA. Needs projects:read and " +
          "tasks:read. " +
          DATA_NOT_INSTRUCTIONS,
        inputSchema: projectParamsSchema,
        outputSchema: boardSchema,
        annotations: READ_ONLY,
      },
      async ({ projectId }) => {
        const project = `/projects/${encodeURIComponent(projectId)}`;

        // The tasks first: a column added meanwhile then simply shows empty.
        const tasks = await loadTasks(api, project);
        if (tasks === TOO_MANY) {
          return messageError(
            `The board of ${projectId} has more than ` +
              `${String(MAX_BOARD_PAGES * MAX_PAGE_LIMIT)} tasks, more than this tool loads.`,
            redact,
          );
        }
        if (!tasks.ok) return toolError(tasks.error, redact);

        const columns = await api.get(`${project}/columns`, columnListSchema);
        if (!columns.ok) return toolError(columns.error, redact);

        const board: Board = {
          columns: columns.value.items.map((column) => ({ ...column, tasks: [] })),
        };
        const byId = new Map(board.columns.map((column) => [column.id, column.tasks]));
        for (const task of tasks.value) {
          const list = byId.get(task.columnId);
          if (list === undefined) {
            return messageError(
              "The board changed while it was loading; call the tool again.",
              redact,
            );
          }
          list.push(task);
        }
        return readResult(summary(projectId, board), board, redact);
      },
    );
  },
};
