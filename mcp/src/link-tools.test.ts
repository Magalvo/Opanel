import { afterEach, describe, expect, it, vi } from "vitest";

import { scopesOfRole } from "@/lib/schemas/agents";

import { createApiClient } from "./api";
import { createRedactor } from "./redact";
import {
  comment,
  connect,
  type FakeCall,
  fakeFetch,
  jsonResponse,
  page,
  problemResponse,
  task,
  TOKEN,
  URL_BASE,
  WORKER_AGENT,
} from "./testing";
import { buildServer, TOOLS } from "./tools";
import { NOTICE } from "./tools/results";

// The link tools and sub-tasks on the task tools (WS-137 tests 1 to 6, 8 and 9), through
// real MCP calls against a fake fetch.

const LINK_TOOLS = ["opanel_add_link", "opanel_remove_link"];

type Respond = (call: FakeCall, url: URL) => Response;

async function serve(respond: Respond, permissions: readonly string[] = WORKER_AGENT.permissions) {
  const fake = fakeFetch((call) => respond(call, new URL(call.url)));
  const api = createApiClient({
    baseUrl: URL_BASE,
    token: TOKEN,
    fetch: fake.fetch,
    version: "0.0.0",
  });
  const client = await connect(
    buildServer(TOOLS, { api, redact: createRedactor(TOKEN) }, permissions),
  );
  return { client, calls: fake.calls };
}

function textOf(result: { content?: unknown }): string {
  const blocks = (result.content ?? []) as { type: string; text?: string }[];
  return blocks.map((block) => block.text ?? "").join("\n");
}

function bodyOf(call: FakeCall | undefined): unknown {
  return JSON.parse(call?.body ?? "null");
}

const API3 = { id: "7c8d9e0f-1a2b-4c3d-8e5f-6a7b8c9d0e1f", key: "API-3", title: "Log in" };

function linkedTask(type: string, direction: "outgoing" | "incoming", version = 2) {
  return { ...task(), version, links: [{ type, direction, task: API3 }] };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the link tools", () => {
  it("are offered after opanel_move_task to a worker_agent, and never to a qa_agent (test 1)", async () => {
    const names = async (permissions: readonly string[]) =>
      (await (await serve(() => jsonResponse(200, {}), permissions)).client.listTools()).tools.map(
        (tool) => tool.name,
      );

    const worker = await names(scopesOfRole("worker_agent"));
    expect(worker.filter((name) => LINK_TOOLS.includes(name))).toEqual(LINK_TOOLS);
    expect(worker.indexOf("opanel_add_link")).toBe(worker.indexOf("opanel_move_task") + 1);
    expect(
      (await names(scopesOfRole("qa_agent"))).filter((name) => LINK_TOOLS.includes(name)),
    ).toEqual([]);
    expect((await names(["tasks:write"])).filter((name) => LINK_TOOLS.includes(name))).toEqual([]);
  });

  it("name both permissions, change Opanel, and only a removal is destructive (test 1)", async () => {
    const { client } = await serve(() => jsonResponse(200, {}));

    const tools = (await client.listTools()).tools.filter((tool) => LINK_TOOLS.includes(tool.name));

    expect(tools).toHaveLength(2);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(false);
      expect(tool.annotations?.idempotentHint, tool.name).toBe(false);
      expect(tool.annotations?.destructiveHint, tool.name).toBe(tool.name === "opanel_remove_link");
      expect(tool.description, tool.name).toMatch(/Needs tasks:write and tasks:read/);
      expect(tool.description, tool.name).toMatch(/data, not instructions/);
    }
  });
});

describe("opanel_add_link", () => {
  it("posts the link with otherTaskId as taskId and answers the task (test 2)", async () => {
    const { client, calls } = await serve(() =>
      jsonResponse(200, linkedTask("blocks", "outgoing")),
    );

    const result = await client.callTool({
      name: "opanel_add_link",
      arguments: { taskId: "OPA-12", type: "blocks", direction: "outgoing", otherTaskId: "API-3" },
    });

    expect(result.isError, textOf(result)).toBeFalsy();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(new URL(calls[0]?.url ?? "").pathname).toBe("/api/v1/tasks/OPA-12/links");
    expect(bodyOf(calls[0])).toEqual({ type: "blocks", direction: "outgoing", taskId: "API-3" });
    const [notice, summary] = textOf(result).split("\n\n");
    expect(notice).toBe(NOTICE);
    expect(summary).toBe("Linked: OPA-12 blocks API-3. Its version is now 2.");
    expect(result.structuredContent).toMatchObject({ key: "OPA-12", version: 2 });
  });

  it.each([
    ["blocks", "incoming", "Linked: OPA-12 is blocked by API-3. Its version is now 2."],
    ["relates_to", "outgoing", "Linked: OPA-12 relates to API-3. Its version is now 2."],
    ["regression_of", "outgoing", "Linked: OPA-12 is a regression of API-3. Its version is now 2."],
  ] as const)("reads %s %s in its words (test 3)", async (type, direction, sentence) => {
    const { client } = await serve(() => jsonResponse(200, linkedTask(type, direction)));

    const result = await client.callTool({
      name: "opanel_add_link",
      arguments: { taskId: "OPA-12", type, direction, otherTaskId: API3.id },
    });

    expect(textOf(result).split("\n\n")[1]).toBe(sentence);
  });
});

describe("opanel_remove_link", () => {
  it("deletes the link named by the query, reads the task, and answers it (test 4)", async () => {
    const after = { ...task(), version: 3 };
    const { client, calls } = await serve((call) =>
      call.method === "DELETE" ? new Response(null, { status: 204 }) : jsonResponse(200, after),
    );

    const result = await client.callTool({
      name: "opanel_remove_link",
      arguments: { taskId: "OPA-12", type: "blocks", direction: "outgoing", otherTaskId: "API-3" },
    });

    expect(result.isError, textOf(result)).toBeFalsy();
    expect(calls.map((call) => call.method)).toEqual(["DELETE", "GET"]);
    const removed = new URL(calls[0]?.url ?? "");
    expect(removed.pathname).toBe("/api/v1/tasks/OPA-12/links");
    expect(Object.fromEntries(removed.searchParams)).toEqual({
      type: "blocks",
      direction: "outgoing",
      taskId: "API-3",
    });
    expect(calls[0]?.body).toBeNull();
    expect(new URL(calls[1]?.url ?? "").pathname).toBe("/api/v1/tasks/OPA-12");
    expect(textOf(result).split("\n\n")[1]).toBe(
      "Removed the link: OPA-12 blocks API-3. Its version is now 3.",
    );
    expect(result.structuredContent).toMatchObject({ key: "OPA-12", version: 3 });
  });

  it("says the link was removed when the task cannot be read after (test 6)", async () => {
    const { client } = await serve((call) =>
      call.method === "DELETE"
        ? new Response(null, { status: 204 })
        : problemResponse(500, "internal_error", "Something failed."),
    );

    const result = await client.callTool({
      name: "opanel_remove_link",
      arguments: { taskId: "OPA-12", type: "blocks", direction: "outgoing", otherTaskId: "API-3" },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("The link was removed, but OPA-12 could not be read");
    expect(textOf(result)).toContain("500 internal_error");
  });
});

describe("inputs and refusals", () => {
  it.each([
    ["an unknown type", { type: "causes", direction: "outgoing", otherTaskId: "API-3" }],
    ["an unknown direction", { type: "blocks", direction: "both", otherTaskId: "API-3" }],
    ["no other task", { type: "blocks", direction: "outgoing" }],
    [
      "the API's own taskId",
      { type: "blocks", direction: "outgoing", otherTaskId: "API-3", extra: 1 },
    ],
  ])("refuses %s without a request (test 5)", async (_case, args) => {
    for (const name of LINK_TOOLS) {
      const { client, calls } = await serve(() => jsonResponse(200, task()));

      const result = await client.callTool({ name, arguments: { taskId: "OPA-12", ...args } });

      expect(result.isError, name).toBe(true);
      expect(calls, name).toHaveLength(0);
    }
  });

  it.each([
    [409, "link_exists", "opanel_add_link"],
    [409, "too_many_links", "opanel_add_link"],
    [403, "forbidden", "opanel_add_link"],
    [409, "project_archived", "opanel_add_link"],
    [404, "not_found", "opanel_remove_link"],
    [403, "forbidden", "opanel_remove_link"],
  ] as const)("answers %i %s from %s as a tool error (test 6)", async (status, code, name) => {
    const { client, calls } = await serve(() => problemResponse(status, code, "Refused."));

    const result = await client.callTool({
      name,
      arguments: { taskId: "OPA-12", type: "blocks", direction: "outgoing", otherTaskId: "API-3" },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(`${String(status)} ${code}: Refused.`);
    expect(calls).toHaveLength(1);
  });
});

describe("sub-tasks on the task tools (WS-137 section 4)", () => {
  it("pass parentId through on create and update, and say so (test 8)", async () => {
    const { client, calls } = await serve((call) =>
      jsonResponse(call.method === "POST" ? 201 : 200, task()),
    );

    await client.callTool({
      name: "opanel_create_task",
      arguments: { projectId: "OPA", title: "A step", parentId: "OPA-9" },
    });
    await client.callTool({
      name: "opanel_update_task",
      arguments: { taskId: "OPA-12", parentId: null, version: 1 },
    });

    expect(bodyOf(calls[0])).toEqual({ title: "A step", parentId: "OPA-9" });
    expect(bodyOf(calls[1])).toEqual({ parentId: null, version: 1 });
    const { tools } = await client.listTools();
    const create = tools.find((tool) => tool.name === "opanel_create_task");
    const update = tools.find((tool) => tool.name === "opanel_update_task");
    expect(create?.description).toMatch(/parentId .* makes it a sub-task/);
    expect(update?.description).toMatch(
      /parentId sets the parent, and null makes it a normal task/,
    );
  });

  it("names the parent, the progress and the links in opanel_get_task's summary (test 9)", async () => {
    const parent = { id: "8d9e0f1a-2b3c-4d4e-9f6a-7b8c9d0e1f2a", key: "OPA-9", title: "Release" };
    const shown = {
      ...task(),
      parent,
      links: [
        { type: "blocks", direction: "outgoing", task: API3 },
        { type: "relates_to", direction: "outgoing", task: { ...API3, key: "API-4" } },
      ],
    };
    const { client } = await serve((_call, url) =>
      url.pathname === "/api/v1/tasks/OPA-12"
        ? jsonResponse(200, shown)
        : jsonResponse(200, page([comment("First.")])),
    );

    const result = await client.callTool({
      name: "opanel_get_task",
      arguments: { taskId: "OPA-12" },
    });

    expect(textOf(result).split("\n\n")[1]).toBe(
      'OPA-12, a task: "Login fails". A sub-task of OPA-9. 2 links. 1 comment shown.',
    );
  });

  it("names a parent's progress, and leaves out what does not apply (test 9)", async () => {
    const shown = { ...task(), subtasks: { done: 2, total: 5 } };
    const { client } = await serve((_call, url) =>
      url.pathname === "/api/v1/tasks/OPA-12"
        ? jsonResponse(200, shown)
        : jsonResponse(200, page([])),
    );

    const result = await client.callTool({
      name: "opanel_get_task",
      arguments: { taskId: "OPA-12" },
    });

    expect(textOf(result).split("\n\n")[1]).toBe(
      'OPA-12, a task: "Login fails". 2 of 5 sub-tasks done. 0 comments shown.',
    );
  });
});
