import type { CallToolResult } from "@modelcontextprotocol/server";

import { taskSchema } from "@/lib/schemas/tasks";

import type { ToolFailure } from "./api";
import type { Redactor } from "./redact";
import { NOTICE } from "./tools/results";

// API failures as MCP tool errors (doc 0005 section 5).

function sentence(failure: ToolFailure): string {
  switch (failure.kind) {
    case "problem":
      return `Opanel answered ${String(failure.status)} ${failure.code}: ${failure.detail} (request ${failure.requestId})`;
    case "unexpected_response":
      return (
        `Opanel gave an unexpected answer (status ${String(failure.status)})` +
        (failure.requestId === null ? "." : ` (request ${failure.requestId}).`)
      );
    case "unreachable":
      return failure.message;
  }
}

/** The failure without a conflict's current entity, which only `conflictError` checks. */
function withoutCurrent(failure: ToolFailure): ToolFailure {
  if (failure.kind !== "problem" || failure.current === undefined) return failure;
  const { current: _current, ...rest } = failure;
  return rest;
}

/** A failure as a tool error: a sentence for the assistant, then the failure as JSON. */
export function toolError(failure: ToolFailure, redact: Redactor): CallToolResult {
  const shown = withoutCurrent(failure);
  const text = `${sentence(shown)}\n\n${JSON.stringify(shown, null, 2)}`;
  return { isError: true, content: [{ type: "text", text: redact(text) }] };
}

/**
 * The failure of a write sent with `version` (WS-104). A `version_conflict` whose current
 * task matches the task schema answers that task, so the assistant can look again and
 * retry; any other failure, or a current task that does not match, is `toolError`.
 */
export function conflictError(
  failure: ToolFailure,
  sentVersion: number,
  redact: Redactor,
): CallToolResult {
  if (failure.kind !== "problem" || failure.code !== "version_conflict") {
    return toolError(failure, redact);
  }
  const current = taskSchema.safeParse(failure.current);
  if (!current.success) return toolError(failure, redact);
  const task = current.data;
  const text =
    `${task.key} changed since version ${String(sentVersion)}; it is now at version ` +
    `${String(task.version)}. Look at the current task before trying again.\n\n${NOTICE}\n\n` +
    JSON.stringify({ ...withoutCurrent(failure), current: task }, null, 2);
  return { isError: true, content: [{ type: "text", text: redact(text) }] };
}

/** A tool error of the server's own, such as a board that changed while it was loading. */
export function messageError(message: string, redact: Redactor): CallToolResult {
  return { isError: true, content: [{ type: "text", text: redact(message) }] };
}
