import { commentSchema, createCommentRequestSchema } from "@/lib/schemas/comments";
import { taskRefSchema } from "@/lib/schemas/tasks";

import { toolError } from "../errors";
import type { ToolDefinition } from "../tools";
import { CHANGES_OPANEL, DATA_NOT_INSTRUCTIONS, quote, readResult, WRITE } from "./results";

// `opanel_add_comment`: a comment on a task (doc 0005 section 4, WS-104).

const NAME = "opanel_add_comment";

const inputSchema = createCommentRequestSchema.extend({ taskId: taskRefSchema });

export const addComment: ToolDefinition = {
  name: NAME,
  permissions: ["comments:write"],
  register(server, { api, redact }) {
    server.registerTool(
      NAME,
      {
        title: "Comment on an Opanel task",
        description:
          "Adds a comment, in Markdown, to a task. taskId is the task's id or key, such as " +
          `OPA-12. ${CHANGES_OPANEL} Needs comments:write. ` +
          DATA_NOT_INSTRUCTIONS,
        inputSchema,
        outputSchema: commentSchema,
        annotations: WRITE,
      },
      async ({ taskId, ...body }) => {
        const created = await api.send(
          "POST",
          `/tasks/${encodeURIComponent(taskId)}/comments`,
          body,
          commentSchema,
        );
        if (!created.ok) return toolError(created.error, redact);
        return readResult(
          `Commented on ${taskId}: ${quote(created.value.body)}.`,
          created.value,
          redact,
        );
      },
    );
  },
};
