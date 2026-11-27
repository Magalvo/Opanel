import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, type McpServer } from "@modelcontextprotocol/server";

import type { AgentMe } from "@/lib/schemas/auth";

// Test helpers of the MCP package (WS-099). Never imported by the server itself.

export const TOKEN = `opk_abcdefghijkl_${"0123456789abcdef".repeat(4)}`;
export const URL_BASE = "https://opanel.example.com";
export const REQUEST_ID = "6f9b2a64-1f7c-4d6e-9a43-2b1c0d5e7f80";

export const QA_AGENT: AgentMe = {
  id: "0b5f3c1e-8d2a-4f6b-9c7e-1a2b3c4d5e6f",
  kind: "agent",
  name: "QA bot",
  role: "qa_agent",
  permissions: ["comments:write", "projects:read", "reports:write", "tasks:read"],
  projectIds: null,
};

/** An agent holding every scope of the `worker_agent` role (WS-104). */
export const WORKER_AGENT: AgentMe = {
  ...QA_AGENT,
  name: "Worker bot",
  role: "worker_agent",
  permissions: ["comments:write", "projects:read", "reports:write", "tasks:read", "tasks:write"],
};

export interface FakeCall {
  url: string;
  headers: Headers;
  method: string;
  /** The request's body as text; `null` for a request without one. */
  body: string | null;
}

/** A `fetch` that answers every request with `respond`, and records the requests. */
export function fakeFetch(respond: (call: FakeCall) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];
  const fake: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const body = request.body === null ? null : await request.text();
    const call = { url: request.url, headers: request.headers, method: request.method, body };
    calls.push(call);
    return respond(call);
  };
  return { fetch: fake, calls };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-Id": REQUEST_ID },
  });
}

export function problemResponse(
  status: number,
  code: string,
  detail: string,
  extra: Record<string, unknown> = {},
): Response {
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title: "Error",
      status,
      code,
      detail,
      requestId: REQUEST_ID,
      ...extra,
    }),
    {
      status,
      headers: { "Content-Type": "application/problem+json", "X-Request-Id": REQUEST_ID },
    },
  );
}

/** A stderr stand-in that keeps what is written. */
export function memoryStream(): { write: (text: string) => void; text: () => string } {
  const chunks: string[] = [];
  return {
    write: (text) => {
      chunks.push(text);
    },
    text: () => chunks.join(""),
  };
}

/** Connects the SDK's client to `server` in memory. */
export async function connect(server: McpServer): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
  return client;
}

// Fixtures of the read tools (WS-100), each valid against its shared schema.

const AT = "2026-11-21T10:00:00.000Z";

export const PROJECT_ID = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
export const TODO_ID = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
export const DOING_ID = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";
export const DONE_ID = "4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c";
export const TASK_ID = "5a6b7c8d-9e0f-4a1b-8c3d-4e5f6a7b8c9d";

export function project(name = "Opanel", key = "OPA") {
  return {
    id: PROJECT_ID,
    key,
    name,
    description: "",
    archivedAt: null,
    sprintsEnabled: false,
    version: 1,
    createdAt: AT,
    updatedAt: AT,
  };
}

export function column(id: string, name: string, category: "todo" | "in_progress" | "done") {
  return { id, projectId: PROJECT_ID, name, category, version: 1, createdAt: AT, updatedAt: AT };
}

export const COLUMNS = [
  column(TODO_ID, "To do", "todo"),
  column(DOING_ID, "In progress", "in_progress"),
  column(DONE_ID, "Done", "done"),
];

export function taskSummary(
  number: number,
  columnId: string | null,
  title = `Task ${String(number)}`,
) {
  return {
    id: crypto.randomUUID(),
    key: `OPA-${String(number)}`,
    number,
    projectId: PROJECT_ID,
    type: "task" as const,
    title,
    columnId,
    assigneeTeam: null,
    assignee: null,
    epic: null,
    parent: null,
    reporter: { id: QA_AGENT.id, name: "QA bot", kind: "agent" as const },
    severity: null,
    fingerprint: null,
    occurrences: 0,
    lastReportedAt: null,
    priority: "none",
    dueDate: null,
    storyPoints: null,
    labels: [],
    subtasks: null,
    version: 1,
    createdAt: AT,
    updatedAt: AT,
    deletedAt: null,
  };
}

export function task(title = "Login fails") {
  return {
    ...taskSummary(12, TODO_ID, title),
    id: TASK_ID,
    description: "Steps to reproduce.",
    links: [],
    subtaskList: [],
  };
}

export function comment(body: string) {
  return {
    id: crypto.randomUUID(),
    taskId: TASK_ID,
    kind: "user" as const,
    author: { id: QA_AGENT.id, name: "QA bot", kind: "agent" as const },
    body,
    createdAt: AT,
  };
}

export function team(name: string, memberCount = 2) {
  return { id: crypto.randomUUID(), name, memberCount, createdAt: AT };
}

export function person(name: string, active = true) {
  return { id: crypto.randomUUID(), name, active };
}

export function page<T>(items: T[], nextCursor: string | null = null) {
  return { items, nextCursor };
}

// Answers of the bug-report endpoint (WS-105).

export const TEAM_ID = "7c8d9e0f-1a2b-4c3d-8e5f-6a7b8c9d0e1f";

export function bugCreated(assignedTeamId: string | null = TEAM_ID) {
  return { outcome: "created" as const, taskId: TASK_ID, taskKey: "OPA-13", assignedTeamId };
}

export function bugDeduplicated(occurrences = 3) {
  return { outcome: "deduplicated" as const, taskId: TASK_ID, taskKey: "OPA-12", occurrences };
}
