import { z } from "zod";

import { projectRefSchema } from "@/lib/schemas/projects";
import { createTaskFields, taskSchema, withCreateTaskRules } from "@/lib/schemas/tasks";

import { toolError } from "../errors";
import type { ToolDefinition } from "../tools";
import { CHANGES_OPANEL, DATA_NOT_INSTRUCTIONS, readResult, taskLabel, WRITE } from "./results";

// `opanel_create_task`: a new task in a project (doc 0005 section 4, WS-104).

const NAME = "opanel_create_task";

// No `labelIds`: no agent may apply labels (WT-07 question 5, WS-107 section 7).
const inputSchema = withCreateTaskRules(
  z.strictObject({ ...createTaskFields, projectId: projectRefSchema }),
);

export const createTask: ToolDefinition = {
  name: NAME,
  permissions: ["tasks:write"],
  register(server, { api, redact }) {
    server.registerTool(
      NAME,
      {
        title: "Create an Opanel task",
        description:
          "Creates a task in a project: in the project's first column by default, in the " +
          "column columnId, or at the end of the backlog with columnId null. projectId is the " +
          "project's id or key. Ids of columns come from opanel_get_board, of teams from " +
          "opanel_list_teams and of people from opanel_find_people. A severity is for bugs " +
          "only. parentId (a task's id or key, of the same project) makes it a sub-task, " +
          `which takes its parent's epic. ${CHANGES_OPANEL} Needs tasks:write. ` +
          DATA_NOT_INSTRUCTIONS,
        inputSchema,
        outputSchema: taskSchema,
        annotations: WRITE,
      },
      async ({ projectId, ...body }) => {
        const created = await api.send(
          "POST",
          `/projects/${encodeURIComponent(projectId)}/tasks`,
          body,
          taskSchema,
        );
        if (!created.ok) return toolError(created.error, redact);
        const task = created.value;
        const where = task.columnId === null ? ", in the backlog" : "";
        return readResult(`Created ${taskLabel(task)}${where}.`, task, redact);
      },
    );
  },
};
