import { McpServer } from "@modelcontextprotocol/server";

import type { Permission } from "@/lib/schemas/permissions";

import type { ApiClient } from "./api";
import type { Redactor } from "./redact";
import { getTaskActivity } from "./tools/activity";
import { getBacklog } from "./tools/backlog";
import { getBoard } from "./tools/board";
import { submitBugReport } from "./tools/bug-report";
import { addComment } from "./tools/comment";
import { createTask } from "./tools/create-task";
import { listEpics } from "./tools/epics";
import { listLabels } from "./tools/labels";
import { addLink, removeLink } from "./tools/links";
import { moveTask } from "./tools/move-task";
import { findPeople } from "./tools/people";
import { listProjects } from "./tools/projects";
import { searchTasks } from "./tools/search";
import { listSprints } from "./tools/sprints";
import { getTask } from "./tools/task";
import { listTeams } from "./tools/teams";
import { updateTask } from "./tools/update-task";
import { whoami } from "./tools/whoami";
import { VERSION } from "./version";

// The tools, and which of them an agent is offered (doc 0005 sections 3 and 4).

export interface ToolContext {
  api: ApiClient;
  redact: Redactor;
}

export interface ToolDefinition {
  name: string;
  /** Every permission the tool's API calls need; `[]` for a tool any agent may use. */
  permissions: readonly Permission[];
  register(server: McpServer, context: ToolContext): void;
}

/** Every tool, in the order they are listed. */
export const TOOLS: readonly ToolDefinition[] = [
  whoami,
  // The project reads, then teams and people, then the task reads (WS-132 question 1).
  listProjects,
  getBoard,
  getBacklog,
  listLabels,
  listEpics,
  listSprints, // WS-143
  listTeams,
  findPeople,
  searchTasks,
  getTask,
  getTaskActivity,
  // The writes (WS-104).
  addComment,
  createTask,
  updateTask,
  moveTask,
  addLink, // WS-137
  removeLink,
  submitBugReport, // WS-105
];

/** The tools the agent may use: an assistant is never shown a tool that can only fail. */
export function offeredTools(
  definitions: readonly ToolDefinition[],
  permissions: readonly string[],
): ToolDefinition[] {
  const held = new Set(permissions);
  return definitions.filter((tool) => tool.permissions.every((permission) => held.has(permission)));
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
