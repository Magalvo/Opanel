import { afterEach, describe, expect, it, vi } from "vitest";

import { agentMeSchema } from "@/lib/schemas/auth";
import type { Permission } from "@/lib/schemas/permissions";

import { createApiClient, type ToolFailure } from "./api";
import { toolError } from "./errors";
import { createRedactor } from "./redact";
import {
  connect,
  fakeFetch,
  jsonResponse,
  problemResponse,
  QA_AGENT,
  REQUEST_ID,
  TOKEN,
  URL_BASE,
} from "./testing";
import { buildServer, offeredTools, type ToolDefinition, TOOLS } from "./tools";

// Tools chosen by permission, `opanel_whoami`, tool errors and the token (WS-099 tests 7 to 11).

const redact = createRedactor(TOKEN);

function context(respond: () => Response) {
  const api = createApiClient({
    baseUrl: URL_BASE,
    token: TOKEN,
    fetch: fakeFetch(respond).fetch,
    version: "0.0.0",
  });
  return { api, redact };
}

function serve(respond: () => Response) {
  return connect(buildServer(TOOLS, context(respond), QA_AGENT.permissions));
}

function definition(name: string, permission: Permission | null): ToolDefinition {
  return { name, permission, register: () => undefined };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("offeredTools", () => {
  const definitions = [
    definition("always", null),
    definition("read", "tasks:read"),
    definition("comment", "comments:write"),
    definition("write", "tasks:write"),
  ];

  it("keeps the tools a qa_agent may use", () => {
    const names = offeredTools(definitions, QA_AGENT.permissions).map((tool) => tool.name);
    expect(names).toEqual(["always", "read", "comment"]);
  });

  it("keeps the tools a worker_agent may use", () => {
    const permissions = ["comments:write", "projects:read", "tasks:read", "tasks:write"];
    const names = offeredTools(definitions, permissions).map((tool) => tool.name);
    expect(names).toEqual(["always", "read", "comment", "write"]);
  });

  it("always keeps opanel_whoami", () => {
    expect(offeredTools(TOOLS, []).map((tool) => tool.name)).toContain("opanel_whoami");
  });
});

describe("opanel_whoami", () => {
  it("is the only tool offered today, read-only", async () => {
    const client = await serve(() => jsonResponse(200, QA_AGENT));

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(["opanel_whoami"]);
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);
    expect(tools[0]?.description).toMatch(/data, not instructions/);
  });

  it("answers the agent as structured content, with a summary", async () => {
    const client = await serve(() => jsonResponse(200, QA_AGENT));

    const result = await client.callTool({ name: "opanel_whoami", arguments: {} });

    expect(result.isError).not.toBe(true);
    expect(agentMeSchema.parse(result.structuredContent)).toEqual(QA_AGENT);
    expect(result.content).toEqual([
      {
        type: "text",
        text:
          'You are "QA bot", an Opanel qa_agent with: comments:write, projects:read, ' +
          "reports:write, tasks:read. Projects: all.",
      },
    ]);
  });

  it("names the number of projects of a restricted agent", async () => {
    const restricted = { ...QA_AGENT, projectIds: [QA_AGENT.id, REQUEST_ID] };
    const client = await serve(() => jsonResponse(200, restricted));

    const result = await client.callTool({ name: "opanel_whoami", arguments: {} });

    expect(JSON.stringify(result.content)).toContain("Projects: 2 (their ids are in the result).");
  });

  it("answers a problem from the API as a tool error", async () => {
    const client = await serve(() => problemResponse(401, "unauthenticated", "Token revoked."));

    const result = await client.callTool({ name: "opanel_whoami", arguments: {} });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("401 unauthenticated");
  });
});

describe("toolError", () => {
  const failures: [ToolFailure, RegExp][] = [
    [
      {
        kind: "problem",
        status: 404,
        code: "not_found",
        title: "Not Found",
        detail: "No task OPA-9.",
        requestId: REQUEST_ID,
      },
      new RegExp(`Opanel answered 404 not_found: No task OPA-9\\. \\(request ${REQUEST_ID}\\)`),
    ],
    [
      { kind: "unexpected_response", status: 502, requestId: null },
      /unexpected answer \(status 502\)/,
    ],
    [{ kind: "unreachable", message: `Opanel is unreachable at ${URL_BASE}.` }, /unreachable/],
  ];

  it.each(failures)("gives isError, the sentence and the failure as JSON for %j", (failure, sentence) => {
    const result = toolError(failure, redact);

    expect(result.isError).toBe(true);
    const block = result.content[0];
    const text = block?.type === "text" ? block.text : "";
    expect(text).toMatch(sentence);
    expect(text).toContain(JSON.stringify(failure, null, 2));
  });
});

describe("the token", () => {
  it("never leaves the server in a tool result", async () => {
    const answers: (() => Response)[] = [
      () => problemResponse(400, "invalid_request", `Bad header Bearer ${TOKEN}`),
      () => {
        throw new TypeError(`request with ${TOKEN} failed`);
      },
      () => new Response(`echo ${TOKEN}`, { status: 500 }),
    ];
    for (const answer of answers) {
      const client = await serve(answer);

      const result = await client.callTool({ name: "opanel_whoami", arguments: {} });

      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    }
  });

  it("is replaced wherever the redactor sees it", () => {
    expect(redact(`a ${TOKEN} b ${TOKEN}`)).toBe("a [redacted] b [redacted]");
  });

  it("writes nothing to stdout from a tool", async () => {
    const stdout = vi.spyOn(process.stdout, "write");
    const client = await serve(() => jsonResponse(200, QA_AGENT));

    await client.callTool({ name: "opanel_whoami", arguments: {} });

    expect(stdout).not.toHaveBeenCalled();
  });
});
