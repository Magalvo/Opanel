import { expect, test } from "@playwright/test";

import { commentSchema } from "@/lib/schemas/comments";
import { taskSchema } from "@/lib/schemas/tasks";

import { agentWithToken, headers, json, startServer, taskHistory, uniqueId } from "./agent";

// WS-104 test 12: a worker_agent's assistant creates, updates, moves and comments on a task
// over stdio; a retry on a stale version gets the current task; the task's history records
// each change under the agent; a qa_agent's assistant is offered only the comment.

const WRITE_TOOLS = [
  "opanel_add_comment",
  "opanel_create_task",
  "opanel_update_task",
  "opanel_move_task",
];

test("an agent's assistant creates, updates, moves and comments on a task, as the agent (WS-104)", async ({
  request,
}) => {
  const worker = await agentWithToken(request, "worker_agent");
  const key = `W${uniqueId().slice(0, 6).toUpperCase()}`;
  await json(
    await request.post("/api/v1/projects", { headers, data: { key, name: `MCP writes ${key}` } }),
    201,
  );
  const columns = await json<{ items: { id: string; name: string }[] }>(
    await request.get(`/api/v1/projects/${key}/columns`, { headers }),
    200,
  );
  const inProgress = columns.items.find((column) => column.name === "In progress");
  if (!inProgress) throw new Error("no In progress column");

  const { client, stderr } = await startServer(worker.token);
  try {
    const offered = (await client.listTools()).tools.map((tool) => tool.name);
    expect(offered.filter((name) => WRITE_TOOLS.includes(name))).toEqual(WRITE_TOOLS);

    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      expect(JSON.stringify(result)).not.toContain(worker.token);
      return result.structuredContent;
    };

    const created = taskSchema.parse(
      await call("opanel_create_task", { projectId: key, title: "Made by an agent" }),
    );
    expect(created.reporter.id).toBe(worker.agentId);

    const updated = taskSchema.parse(
      await call("opanel_update_task", {
        taskId: created.key,
        title: "Renamed by an agent",
        version: created.version,
      }),
    );
    expect(updated.title).toBe("Renamed by an agent");

    const moved = taskSchema.parse(
      await call("opanel_move_task", {
        taskId: created.key,
        columnId: inProgress.id,
        version: updated.version,
      }),
    );
    expect(moved.columnId).toBe(inProgress.id);

    const stale = await client.callTool({
      name: "opanel_update_task",
      arguments: { taskId: created.key, title: "Too late", version: updated.version },
    });
    expect(stale.isError).toBe(true);
    const staleText = JSON.stringify(stale.content);
    expect(staleText).toContain(
      `${created.key} changed since version ${String(updated.version)}; it is now at version ` +
        `${String(moved.version)}.`,
    );
    expect(staleText).toContain("Renamed by an agent");

    const comment = commentSchema.parse(
      await call("opanel_add_comment", { taskId: created.key, body: "Done by an agent." }),
    );
    expect(comment.author?.id).toBe(worker.agentId);

    const history = await taskHistory(created.id);
    expect(history.map((event) => event.type)).toEqual([
      "created",
      "field_changed",
      "moved",
      "commented",
    ]);
    expect(history.every((event) => event.actor === worker.agentId)).toBe(true);
  } finally {
    await client.close();
  }
  expect(stderr()).not.toContain(worker.token);
});

test("a qa_agent's assistant is offered only the comment among the writes (WS-104)", async ({
  request,
}) => {
  const qa = await agentWithToken(request);

  const { client } = await startServer(qa.token);
  try {
    const offered = (await client.listTools()).tools.map((tool) => tool.name);
    expect(offered.filter((name) => WRITE_TOOLS.includes(name))).toEqual(["opanel_add_comment"]);
  } finally {
    await client.close();
  }
});
