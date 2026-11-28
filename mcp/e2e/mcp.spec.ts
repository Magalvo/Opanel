import { spawn } from "node:child_process";

import { expect, test } from "@playwright/test";

import { agentMeSchema } from "@/lib/schemas/auth";

import { agentWithToken, environment, SERVER, startServer } from "./agent";

// WS-099 tests E1 to E3: the built server, started over stdio by the SDK's own client,
// against the running app with a real agent token.

/** Runs the server to its exit, as an assistant would start it, and keeps its stderr. */
function runToExit(
  token: string,
): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { env: environment(token) });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stderr, stdout });
    });
  });
}

test("an agent's assistant lists its tools and asks who it is, then a revoked token stops it", async ({
  request,
}) => {
  const agent = await agentWithToken(request);

  const { client, stderr } = await startServer(agent.token);
  try {
    // E1: the tools of a qa_agent (WS-100 adds the read tools, WS-104 the comment, WS-105
    // the bug report, WS-132 the reads of the backlog, labels, epics, search and activity,
    // WS-143 the sprints).
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "opanel_whoami",
      "opanel_list_projects",
      "opanel_get_board",
      "opanel_get_backlog",
      "opanel_list_labels",
      "opanel_list_epics",
      "opanel_list_sprints",
      "opanel_list_teams",
      "opanel_find_people",
      "opanel_search_tasks",
      "opanel_get_task",
      "opanel_get_task_activity",
      "opanel_add_comment",
      "opanel_submit_bug_report",
    ]);

    // E2: the agent, as the API knows it.
    const result = await client.callTool({ name: "opanel_whoami", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(agentMeSchema.parse(result.structuredContent)).toEqual({
      id: agent.agentId,
      kind: "agent",
      name: agent.name,
      role: "qa_agent",
      permissions: agent.scopes,
      projectIds: null,
    });
    expect(JSON.stringify(result)).not.toContain(agent.token);
  } finally {
    await client.close();
  }
  expect(stderr()).not.toContain(agent.token);

  // E3: a revoked token stops the server at start, with a message that never holds it.
  await agent.revoke();
  const run = await runToExit(agent.token);
  expect(run.code).toBe(1);
  expect(run.stderr).toMatch(/OPANEL_TOKEN was rejected/);
  expect(run.stderr).not.toContain(agent.token);
  expect(run.stdout).toBe("");
});
