import { z } from "zod";

import {
  taskRefSchema,
  taskSchema,
  updateTaskFields,
  withUpdateTaskRules,
} from "@/lib/schemas/tasks";

import { conflictError } from "../errors";
import type { ToolDefinition } from "../tools";
import {
  CHANGES_OPANEL,
  DATA_NOT_INSTRUCTIONS,
  readResult,
  REPLACING_WRITE,
  taskLabel,
} from "./results";

// `opanel_update_task`: a task's fields, assignment and epic (doc 0005 section 4, WS-104).

const NAME = "opanel_update_task";

// No `labelIds`: no agent may apply labels (WT-07 question 5, WS-107 section 7).
const inputSchema = withUpdateTaskRules(
  z.strictObject({ ...updateTaskFields, taskId: taskRefSchema }),
);

export const updateTask: ToolDefinition = {
  name: NAME,
  permissions: ["tasks:write"],
  register(server, { api, redact }) {
    server.registerTool(
      NAME,
      {
        title: "Update an Opanel task",
        description:
          "Changes the fields given, and only those: title, description, type, team, " +
          "assignee, epic, severity (bugs only), priority or due date; null clears a field " +
          "that may be empty. parentId sets the parent, and null makes it a normal task again; " +
          "a sub-task's epic is its parent's, so epicId is refused on one. taskId is the " +
          "task's id or key, such as OPA-12. version is the " +
          "task's version as last read (opanel_get_task, opanel_get_board): if someone " +
          "changed the task since, nothing is changed and the answer holds the current " +
          `task. ${CHANGES_OPANEL} Needs tasks:write. ` +
          DATA_NOT_INSTRUCTIONS,
        inputSchema,
        outputSchema: taskSchema,
        annotations: REPLACING_WRITE,
      },
      async ({ taskId, ...body }) => {
        const updated = await api.send(
          "PATCH",
          `/tasks/${encodeURIComponent(taskId)}`,
          body,
          taskSchema,
        );
        if (!updated.ok) return conflictError(updated.error, body.version, redact);
        const task = updated.value;
        return readResult(
          `Updated ${taskLabel(task)}. Its version is now ${String(task.version)}.`,
          task,
          redact,
        );
      },
    );
  },
};
