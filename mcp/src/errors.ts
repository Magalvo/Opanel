import type { CallToolResult } from "@modelcontextprotocol/server";

import type { ToolFailure } from "./api";
import type { Redactor } from "./redact";

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

/** A failure as a tool error: a sentence for the assistant, then the failure as JSON. */
export function toolError(failure: ToolFailure, redact: Redactor): CallToolResult {
  const text = `${sentence(failure)}\n\n${JSON.stringify(failure, null, 2)}`;
  return { isError: true, content: [{ type: "text", text: redact(text) }] };
}

/** A tool error of the server's own, such as a board that changed while it was loading. */
export function messageError(message: string, redact: Redactor): CallToolResult {
  return { isError: true, content: [{ type: "text", text: redact(message) }] };
}
