import { expect, test } from "@playwright/test";

import { scopesOfRole } from "@/lib/schemas/agents";
import { activityPageSchema } from "@/lib/schemas/activity";
import { epicPageSchema } from "@/lib/schemas/epics";
import { labelListSchema } from "@/lib/schemas/labels";
import { taskListItemPageSchema, taskPageSchema } from "@/lib/schemas/tasks";

import { headers, json, signInAsAdmin, startServer, uniqueId } from "./agent";

// WS-132 test 9: an Admin sets up two projects and a qa_agent restricted to the first; the
// agent's assistant reads the backlog, labels and epics, searches and reads a task's
// activity through the new tools over stdio, and cannot reach the second project.

test("an assistant of a restricted agent reads the backlog, labels, epics, a search and an activity", async ({
  request,
}) => {
  const id = uniqueId();
  await signInAsAdmin(request, id);
  const a = `P${id.slice(0, 6).toUpperCase()}`;
  const b = `Q${id.slice(0, 6).toUpperCase()}`;
  const projectIds: Record<string, string> = {};
  for (const key of [a, b]) {
    const made = await json<{ id: string }>(
      await request.post("/api/v1/projects", { headers, data: { key, name: key } }),
      201,
    );
    projectIds[key] = made.id;
  }
  const release = await json<{ id: string }>(
    await request.post(`/api/v1/projects/${a}/labels`, {
      headers,
      data: { name: "release", colour: "blue" },
    }),
    201,
  );
  await json(
    await request.post(`/api/v1/projects/${a}/epics`, { headers, data: { title: "Launch" } }),
    201,
  );
  for (const [key, data] of [
    [a, { title: "Login fails on Safari", type: "bug", priority: "urgent" }],
    [a, { title: "Logout button", columnId: null, priority: "high", labelIds: [release.id] }],
    [a, { title: "Release notes", columnId: null }],
    [b, { title: "Login copy" }],
  ] as const) {
    await json(await request.post(`/api/v1/projects/${key}/tasks`, { headers, data }), 201);
  }
  const current = await json<{ version: number }>(
    await request.get(`/api/v1/tasks/${a}-1`, { headers }),
    200,
  );
  await json(
    await request.patch(`/api/v1/tasks/${a}-1`, {
      headers,
      data: { dueDate: "2030-06-10", version: current.version },
    }),
    200,
  );

  // A qa_agent with every scope of its role, restricted to project A.
  const agent = await json<{ id: string }>(
    await request.post("/api/v1/agents", {
      headers,
      data: {
        name: `MCP finder ${id}`,
        role: "qa_agent",
        scopes: [...scopesOfRole("qa_agent")].sort(),
        projectIds: [projectIds[a]],
      },
    }),
    201,
  );
  const { token } = await json<{ token: string }>(
    await request.post(`/api/v1/agents/${agent.id}/tokens`, { headers, data: { name: "MCP" } }),
    201,
  );

  const { client, stderr } = await startServer(token);
  try {
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      expect(JSON.stringify(result)).not.toContain(token);
      return result.structuredContent;
    };

    const backlog = taskPageSchema.parse(await call("opanel_get_backlog", { projectId: a }));
    expect(backlog.items.map((task) => task.key)).toEqual([`${a}-2`, `${a}-3`]);
    const labelled = taskPageSchema.parse(
      await call("opanel_get_backlog", { projectId: a, labelId: [release.id] }),
    );
    expect(labelled.items.map((task) => task.key)).toEqual([`${a}-2`]);

    const labels = labelListSchema.parse(await call("opanel_list_labels", { projectId: a }));
    expect(labels.items.map((label) => label.name)).toEqual(["release"]);

    const epics = epicPageSchema.parse(await call("opanel_list_epics", { projectId: a }));
    expect(epics.items.map((epic) => epic.title)).toEqual(["Launch"]);

    const words = taskListItemPageSchema.parse(
      await call("opanel_search_tasks", { q: "log", sort: "key" }),
    );
    expect(words.items.map((task) => task.key)).toEqual([`${a}-1`, `${a}-2`]);
    const urgent = taskListItemPageSchema.parse(
      await call("opanel_search_tasks", { priority: ["high", "urgent"], sort: "-priority" }),
    );
    expect(urgent.items.map((task) => task.key)).toEqual([`${a}-1`, `${a}-2`]);
    expect(urgent.items[1]?.column).toBeNull();

    const activity = activityPageSchema.parse(
      await call("opanel_get_task_activity", { taskId: `${a}-1` }),
    );
    const last = activity.items.at(-1);
    expect(last?.kind === "event" ? last.field : null).toBe("dueDate");

    for (const [name, args] of [
      ["opanel_search_tasks", { projectId: b }],
      ["opanel_get_backlog", { projectId: b }],
      ["opanel_get_task_activity", { taskId: `${b}-1` }],
    ] as const) {
      const refused = await client.callTool({ name, arguments: args });
      expect(refused.isError, name).toBe(true);
      expect(JSON.stringify(refused.content), name).toContain("403");
    }
  } finally {
    await client.close();
  }
  expect(stderr()).not.toContain(token);
});
