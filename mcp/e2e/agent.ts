import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { type APIRequestContext, expect } from "@playwright/test";
import postgres from "postgres";

import { scopesOfRole } from "@/lib/schemas/agents";
import type { AgentRole } from "@/lib/schemas/permissions";

import { E2E_BASE_URL, E2E_DATABASE_URL } from "../../tests/e2e/environment";
import { seedAccount } from "../../tests/e2e/seed";

// Helpers of the MCP end-to-end tests (WS-099, WS-100): an Admin, an agent with a token,
// and the built server started over stdio by the SDK's own client.

export const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));
export const headers = { Origin: E2E_BASE_URL };
const password = "an e2e mcp server password, long enough";

export async function json<T>(
  response: Awaited<ReturnType<APIRequestContext["get"]>>,
  status: number,
) {
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as T;
}

/** A short random id for unique names. */
export function uniqueId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

/** Signs `request` in as a new Admin and answers the Admin's name. */
export async function signInAsAdmin(request: APIRequestContext, id: string): Promise<string> {
  const email = `mcp-admin-${id}@example.com`;
  const name = `MCP Admin ${id}`;
  await seedAccount({ email, password, role: "admin", name });
  await json(
    await request.post("/api/v1/auth/sign-in", { headers, data: { email, password } }),
    200,
  );
  return name;
}

/**
 * An Admin creates an agent with every scope of its role, `qa_agent` by default, and a
 * token for it, as the operator guide says.
 */
export async function agentWithToken(request: APIRequestContext, role: AgentRole = "qa_agent") {
  const id = uniqueId();
  await signInAsAdmin(request, id);
  // Sorted, as `GET /me` lists permissions.
  const scopes = [...scopesOfRole(role)].sort();
  const agent = await json<{ id: string }>(
    await request.post("/api/v1/agents", {
      headers,
      data: { name: `MCP bot ${id}`, role, scopes, projectIds: null },
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

export function environment(token: string): Record<string, string> {
  return { ...getDefaultEnvironment(), OPANEL_URL: E2E_BASE_URL, OPANEL_TOKEN: token };
}

/** Starts the built server as an assistant would, and connects the SDK's client to it. */
export async function startServer(token: string) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: environment(token),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const client = new Client({ name: "opanel-e2e", version: "0.0.0" });
  await client.connect(transport);
  return { client, stderr: () => stderr };
}

/**
 * A task's history, oldest first, read from the end-to-end database (WS-104): the API has
 * no endpoint for it, and the test checks who each change is recorded under.
 */
export async function taskHistory(
  taskId: string,
): Promise<{ type: string; field: string | null; actor: string | null }[]> {
  const client = postgres(E2E_DATABASE_URL, { onnotice: () => undefined, max: 1 });
  try {
    return await client<{ type: string; field: string | null; actor: string | null }[]>`
      select type, field, actor_account_id as actor from task_events
      where task_id = ${taskId} order by created_at, id`;
  } finally {
    await client.end();
  }
}
