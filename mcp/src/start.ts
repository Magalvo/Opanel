import { type AgentMe, meResponseSchema } from "@/lib/schemas/auth";

import { type ApiClient, createApiClient, type ToolFailure } from "./api";
import { readConfig } from "./config";
import { createRedactor, type Redactor } from "./redact";
import { VERSION } from "./version";

// Start-up (WS-099 section 2): the configuration, then `GET /me`, before serving anything.

export interface StartIo {
  env: Readonly<Record<string, string | undefined>>;
  fetch: typeof fetch;
  /** Where messages go. Never stdout, which is the MCP channel. */
  stderr: { write(text: string): unknown };
}

export type Prepared = { ok: true; me: AgentMe; api: ApiClient; redact: Redactor } | { ok: false };

function failureMessage(failure: ToolFailure, url: string): string {
  if (failure.kind === "unreachable") return failure.message;
  if (failure.kind === "unexpected_response") {
    return `${url} does not look like an Opanel server: GET /api/v1/me gave an unexpected answer (status ${String(failure.status)}).`;
  }
  if (failure.status === 401) {
    return "OPANEL_TOKEN was rejected: it is wrong, revoked or expired. Create a new token for the agent in Opanel.";
  }
  if (failure.code === "agent_disabled") {
    return "The agent account of OPANEL_TOKEN is disabled. An Admin can enable it in Opanel.";
  }
  return `GET /api/v1/me failed: ${String(failure.status)} ${failure.code} (request ${failure.requestId}).`;
}

export async function prepare(io: StartIo): Promise<Prepared> {
  const fail = (message: string, redact: Redactor = (text) => text): Prepared => {
    io.stderr.write(`opanel-mcp: ${redact(message)}\n`);
    return { ok: false };
  };

  const read = readConfig(io.env);
  if (!read.ok) return fail(read.message);
  const { url, token } = read.config;
  const redact = createRedactor(token);
  if (read.warning !== null) io.stderr.write(`opanel-mcp: ${redact(read.warning)}\n`);

  const api = createApiClient({ baseUrl: url, token, fetch: io.fetch, version: VERSION });
  const me = await api.get("/me", meResponseSchema);
  if (!me.ok) return fail(failureMessage(me.error, url), redact);
  if (me.value.kind !== "agent") {
    return fail(
      "OPANEL_TOKEN is not an agent's: the MCP server acts only as an agent account.",
      redact,
    );
  }
  return { ok: true, me: me.value, api, redact };
}
