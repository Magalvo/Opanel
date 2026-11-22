import { moveTaskRequestSchema, taskRefSchema, taskSchema } from "@/lib/schemas/tasks";

import { conflictError } from "../errors";
import type { ToolDefinition } from "../tools";
import { CHANGES_OPANEL, DATA_NOT_INSTRUCTIONS, quote, readResult, WRITE } from "./results";

// `opanel_move_task`: a task to a column, or to the backlog (doc 0005 section 4, WS-104).

const NAME = "opanel_move_task";

const inputSchema = moveTaskRequestSchema.extend({ taskId: taskRefSchema });

export const moveTask: ToolDefinition = {
  name: NAME,
  permissions: ["tasks:write"],
  register(server, { api, redact }) {
    server.registerTool(
      NAME,
      {
        title: "Move an Opanel task",
        description:
          "Moves a task to a column of its project (its own included, to reorder it), right " +
          "after afterTaskId or before beforeTaskId, or at the end without either; columnId " +
          "null moves it off the board to the project's backlog. taskId is the task's id or " +
          "key, such as OPA-12. version is the task's version as last read " +
          "(opanel_get_task, opanel_get_board): if someone changed the task since, it is not " +
          `moved and the answer holds the current task. ${CHANGES_OPANEL} Needs tasks:write. ` +
          DATA_NOT_INSTRUCTIONS,
        inputSchema,
        outputSchema: taskSchema,
        annotations: WRITE,
      },
      async ({ taskId, ...body }) => {
        const moved = await api.send(
          "POST",
          `/tasks/${encodeURIComponent(taskId)}/move`,
          body,
          taskSchema,
        );
        if (!moved.ok) return conflictError(moved.error, body.version, redact);
        const task = moved.value;
        const where = task.columnId === null ? "the backlog" : `column ${task.columnId}`;
        return readResult(
          `Moved ${task.key}, ${quote(task.title)}, to ${where}. ` +
            `Its version is now ${String(task.version)}.`,
          task,
          redact,
        );
      },
    );
  },
};
