import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { type APIRequestContext, expect, test } from "@playwright/test";

import { agentMeSchema } from "@/lib/schemas/auth";

import { E2E_BASE_URL } from "../../tests/e2e/environment";
import { seedAccount } from "../../tests/e2e/seed";

// WS-099 tests E1 to E3: the built server, started over stdio by the SDK's own client,
// against the running app with a real agent token.

const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const password = "an e2e mcp server password, long enough";
const headers = { Origin: E2E_BASE_URL };

async function json<T>(response: Awaited<ReturnType<APIRequestContext["get"]>>, status: number) {
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as T;
}

/** An Admin creates a qa_agent and a token for it, as the operator guide says. */
async function agentWithToken(request: APIRequestContext) {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const email = `mcp-admin-${id}@example.com`;
  await seedAccount({ email, password, role: "admin", name: `MCP Admin ${id}` });
  await json(
    await request.post("/api/v1/auth/sign-in", { headers, data: { email, password } }),
    200,
  );
  const scopes = ["comments:write", "projects:read", "reports:write", "tasks:read"];
  const agent = await json<{ id: string }>(
    await request.post("/api/v1/agents", {
      headers,
      data: { name: `MCP bot ${id}`, role: "qa_agent", scopes, projectIds: null },
    }),
    201,
  );
  const created = await json<{ token: string; apiToken: { id: string } }>(
    await request.post(`/api/v1/agents/${agent.id}/tokens`, { headers, data: { name: "MCP" } }),
    201,
  );
  const revoke = async () => {
    expect(
      (
        await request.delete(`/api/v1/agents/${agent.id}/tokens/${created.apiToken.id}`, {
          headers,
        })
      ).ok(),
    ).toBe(true);
  };
  return { agentId: agent.id, name: `MCP bot ${id}`, scopes, token: created.token, revoke };
}

function environment(token: string): Record<string, string> {
  return { ...getDefaultEnvironment(), OPANEL_URL: E2E_BASE_URL, OPANEL_TOKEN: token };
}

/** Runs the server to its exit, as an assistant would start it, and keeps its stderr. */
function runToExit(token: string): Promise<{ code: number | null; stderr: string; stdout: string }> {
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

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: environment(agent.token),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const client = new Client({ name: "opanel-e2e", version: "0.0.0" });
  await client.connect(transport);
  try {
    // E1: exactly the tools of item A.
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["opanel_whoami"]);

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
  expect(stderr).not.toContain(agent.token);

  // E3: a revoked token stops the server at start, with a message that never holds it.
  await agent.revoke();
  const run = await runToExit(agent.token);
  expect(run.code).toBe(1);
  expect(run.stderr).toMatch(/OPANEL_TOKEN was rejected/);
  expect(run.stderr).not.toContain(agent.token);
  expect(run.stdout).toBe("");
});
