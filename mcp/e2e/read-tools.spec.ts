import { expect, test } from "@playwright/test";

import { personPageSchema } from "@/lib/schemas/people";
import { projectPageSchema } from "@/lib/schemas/projects";
import { teamPageSchema } from "@/lib/schemas/teams";

import { boardSchema } from "../src/tools/board";
import { taskWithCommentsSchema } from "../src/tools/task";
import { agentWithToken, headers, json, signInAsAdmin, startServer, uniqueId } from "./agent";

// WS-100 test E4: an Admin sets up a project, a team, a task and a comment through the
// API, and the agent's assistant reads them through each read tool over stdio.

test("an agent's assistant reads the projects, the board, the teams, the people and a task", async ({
  request,
}) => {
  const agent = await agentWithToken(request);
  const id = uniqueId();
  const admin = await signInAsAdmin(request, id);
  const me = await json<{ id: string }>(await request.get("/api/v1/me", { headers }), 200);
  const key = `M${id.slice(0, 6).toUpperCase()}`;
  await json(
    await request.post("/api/v1/projects", {
      headers,
      data: { key, name: `MCP project ${id}` },
    }),
    201,
  );
  const team = await json<{ id: string }>(
    await request.post("/api/v1/teams", { headers, data: { name: `MCP team ${id}` } }),
    201,
  );
  await json(
    await request.post(`/api/v1/teams/${team.id}/members`, {
      headers,
      data: { accountId: me.id },
    }),
    200,
  );
  const created = await json<{ key: string }>(
    await request.post(`/api/v1/projects/${key}/tasks`, {
      headers,
      data: { title: "Read me through MCP" },
    }),
    201,
  );
  await json(
    await request.post(`/api/v1/tasks/${created.key}/comments`, {
      headers,
      data: { body: "A comment for the agent." },
    }),
    201,
  );

  const { client, stderr } = await startServer(agent.token);
  try {
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      expect(JSON.stringify(result)).not.toContain(agent.token);
      return result.structuredContent;
    };

    let found = false;
    let cursor: string | undefined;
    do {
      const projects = projectPageSchema.parse(
        await call("opanel_list_projects", { limit: 100, ...(cursor ? { cursor } : {}) }),
      );
      found ||= projects.items.some((project) => project.key === key);
      cursor = projects.nextCursor ?? undefined;
    } while (!found && cursor !== undefined);
    expect(found).toBe(true);

    const board = boardSchema.parse(await call("opanel_get_board", { projectId: key }));
    expect(board.columns.map((column) => column.name)).toEqual(["To do", "In progress", "Done"]);
    expect(board.columns[0]?.tasks.map((task) => task.key)).toEqual([created.key]);

    const teams = teamPageSchema.parse(await call("opanel_list_teams", { limit: 100 }));
    expect(teams.items).toContainEqual(
      expect.objectContaining({ name: `MCP team ${id}`, memberCount: 1 }),
    );

    const people = personPageSchema.parse(await call("opanel_find_people", { q: admin }));
    expect(people.items).toEqual([{ id: me.id, name: admin, active: true }]);

    const task = taskWithCommentsSchema.parse(
      await call("opanel_get_task", { taskId: created.key }),
    );
    expect(task.task.title).toBe("Read me through MCP");
    expect(task.comments.items.map((comment) => comment.body)).toEqual([
      "A comment for the agent.",
    ]);
  } finally {
    await client.close();
  }
  expect(stderr()).not.toContain(agent.token);
});
