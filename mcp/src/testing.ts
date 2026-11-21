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

export interface FakeCall {
  url: string;
  headers: Headers;
  method: string;
}

/** A `fetch` that answers every request with `respond`, and records the requests. */
export function fakeFetch(respond: (call: FakeCall) => Response | Promise<Response>): {
  fetch: typeof fetch;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];
  const fake: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const call = { url: request.url, headers: request.headers, method: request.method };
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
