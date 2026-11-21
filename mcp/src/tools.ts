import { McpServer } from "@modelcontextprotocol/server";

import type { Permission } from "@/lib/schemas/permissions";

import type { ApiClient } from "./api";
import type { Redactor } from "./redact";
import { whoami } from "./tools/whoami";
import { VERSION } from "./version";

// The tools, and which of them an agent is offered (doc 0005 sections 3 and 4).

export interface ToolContext {
  api: ApiClient;
  redact: Redactor;
}

export interface ToolDefinition {
  name: string;
  /** The permission the tool needs, or `null` for one any agent may use. */
  permission: Permission | null;
  register(server: McpServer, context: ToolContext): void;
}

/** Every tool, in the order they are listed. */
export const TOOLS: readonly ToolDefinition[] = [whoami];

/** The tools the agent may use: an assistant is never shown a tool that can only fail. */
export function offeredTools(
  definitions: readonly ToolDefinition[],
  permissions: readonly string[],
): ToolDefinition[] {
  const held = new Set(permissions);
  return definitions.filter((tool) => tool.permission === null || held.has(tool.permission));
}

export function buildServer(
  definitions: readonly ToolDefinition[],
  context: ToolContext,
  permissions: readonly string[],
): McpServer {
  const server = new McpServer({ name: "opanel", version: VERSION });
  for (const tool of offeredTools(definitions, permissions)) tool.register(server, context);
  return server;
}
