import { expect, test } from "@playwright/test";

import { taskSchema } from "@/lib/schemas/tasks";

import { agentWithToken, headers, json, startServer, taskHistory, uniqueId } from "./agent";

// WS-137 test 10: a worker_agent's assistant links tasks of two projects over stdio, reads
// the link from both tasks, removes it, and makes a task a sub-task; each change is
// recorded under the agent.

const LINK_TOOLS = ["opanel_add_link", "opanel_remove_link"];

test("an agent's assistant links and unlinks tasks of two projects, and makes a sub-task (WS-137)", async ({
  request,
}) => {
  const worker = await agentWithToken(request, "worker_agent");
  const web = `L${uniqueId().slice(0, 6).toUpperCase()}`;
  const api = `M${uniqueId().slice(0, 6).toUpperCase()}`;
  for (const key of [web, api]) {
    await json(
      await request.post("/api/v1/projects", { headers, data: { key, name: `MCP links ${key}` } }),
      201,
    );
  }
  for (const [key, title] of [
    [web, "Checkout page"],
    [web, "Pay button"],
    [api, "Payments endpoint"],
  ] as const) {
    await json(
      await request.post(`/api/v1/projects/${key}/tasks`, { headers, data: { title } }),
      201,
    );
  }

  const { client, stderr } = await startServer(worker.token);
  try {
    const offered = (await client.listTools()).tools.map((tool) => tool.name);
    expect(offered.filter((name) => LINK_TOOLS.includes(name))).toEqual(LINK_TOOLS);

    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      expect(JSON.stringify(result)).not.toContain(worker.token);
      return result;
    };

    const link = { type: "blocks", direction: "incoming", otherTaskId: `${api}-1` };
    const added = await call("opanel_add_link", { taskId: `${web}-1`, ...link });
    const linked = taskSchema.parse(added.structuredContent);
    expect(JSON.stringify(added.content)).toContain(`Linked: ${web}-1 is blocked by ${api}-1.`);
    expect(linked.links).toEqual([
      { type: "blocks", direction: "incoming", task: expect.objectContaining({ key: `${api}-1` }) },
    ]);

    // The other task reads the link the other way.
    const other = await call("opanel_get_task", { taskId: `${api}-1` });
    const otherTask = taskSchema.parse((other.structuredContent as { task: unknown }).task);
    expect(otherTask.links).toEqual([
      { type: "blocks", direction: "outgoing", task: expect.objectContaining({ key: `${web}-1` }) },
    ]);

    const removed = await call("opanel_remove_link", { taskId: `${web}-1`, ...link });
    const unlinked = taskSchema.parse(removed.structuredContent);
    expect(unlinked.links).toEqual([]);
    expect(unlinked.version).toBe(linked.version + 1);
    expect(JSON.stringify(removed.content)).toContain(
      `Removed the link: ${web}-1 is blocked by ${api}-1.`,
    );

    // A sub-task, through the task tool's own parentId.
    const sub = taskSchema.parse(
      (
        await call("opanel_update_task", {
          taskId: `${web}-2`,
          parentId: `${web}-1`,
          version: 1,
        })
      ).structuredContent,
    );
    expect(sub.parent?.key).toBe(`${web}-1`);
    const parentRead = await call("opanel_get_task", { taskId: `${web}-1` });
    expect(JSON.stringify(parentRead.content)).toContain("0 of 1 sub-tasks done.");

    const history = await taskHistory(linked.id);
    expect(history.filter((event) => event.type !== "created")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "linked", actor: worker.agentId }),
        expect.objectContaining({ type: "unlinked", actor: worker.agentId }),
      ]),
    );
  } finally {
    await client.close();
  }
  expect(stderr()).not.toContain(worker.token);
});
