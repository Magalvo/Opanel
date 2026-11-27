import { afterEach, describe, expect, it, vi } from "vitest";

import { activityPageSchema } from "@/lib/schemas/activity";
import { epicPageSchema } from "@/lib/schemas/epics";
import { labelListSchema } from "@/lib/schemas/labels";
import { taskListItemPageSchema, taskPageSchema } from "@/lib/schemas/tasks";

import { createApiClient } from "./api";
import { createRedactor } from "./redact";
import {
  comment,
  connect,
  DOING_ID,
  type FakeCall,
  fakeFetch,
  jsonResponse,
  page,
  problemResponse,
  PROJECT_ID,
  QA_AGENT,
  REQUEST_ID,
  TASK_ID,
  taskSummary,
  TOKEN,
  URL_BASE,
  WORKER_AGENT,
} from "./testing";
import { buildServer, TOOLS } from "./tools";
import { NOTICE, query } from "./tools/results";

// The tools for the backlog, labels, epics, search and activity (WS-132 tests 1 to 8),
// through real MCP calls against a fake fetch.

const NEW_TOOLS = [
  "opanel_get_backlog",
  "opanel_list_labels",
  "opanel_list_epics",
  "opanel_search_tasks",
  "opanel_get_task_activity",
];

const AT = "2026-11-21T10:00:00.000Z";
const EPIC_ID = "8d9e0f1a-2b3c-4d4e-8f6a-7b8c9d0e1f2a";

type Respond = (call: FakeCall, url: URL) => Response;

async function serve(respond: Respond, permissions: readonly string[] = QA_AGENT.permissions) {
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
  const urls = () => fake.calls.map((call) => new URL(call.url));
  return { client, calls: fake.calls, urls };
}

function textOf(result: { content?: unknown }): string {
  const blocks = (result.content ?? []) as { type: string; text?: string }[];
  return blocks.map((block) => block.text ?? "").join("\n");
}

/** The summary: the text between the notice and the JSON. */
function summaryOf(result: { content?: unknown }): string {
  return textOf(result).split("\n\n")[1] ?? "";
}

function label(name: string) {
  return {
    id: crypto.randomUUID(),
    projectId: PROJECT_ID,
    name,
    colour: "blue" as const,
    version: 1,
    createdAt: AT,
    updatedAt: AT,
  };
}

function epic(title: string, status: "open" | "closed" = "open") {
  return {
    id: crypto.randomUUID(),
    projectId: PROJECT_ID,
    title,
    description: "",
    status,
    startDate: null,
    targetDate: null,
    progress: { doneTasks: 1, totalTasks: 3, donePoints: 0, totalPoints: 0, unestimated: 3 },
    version: 1,
    createdAt: AT,
    updatedAt: AT,
  };
}

function listItem(number: number, key: string, column: string | null, type = "task") {
  const summary = taskSummary(number, column === null ? null : DOING_ID, `Task ${key}`);
  return {
    ...summary,
    key: `${key}-${String(number)}`,
    type: type as "task",
    project: { id: PROJECT_ID, key, name: key },
    column: column === null ? null : { id: DOING_ID, name: column, category: "in_progress" },
  };
}

function change(field: string) {
  return {
    kind: "event" as const,
    id: crypto.randomUUID(),
    type: "field_changed" as const,
    field,
    oldValue: "none",
    newValue: "high",
    actor: { id: QA_AGENT.id, name: "QA bot", kind: "agent" as const },
    createdAt: AT,
  };
}

const notFound = () => problemResponse(404, "not_found", "Nothing here.");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("query (WS-132 test 1)", () => {
  it("appends each value of an array, in order, and leaves out absent fields", () => {
    expect(
      query({ q: "log in", priority: ["high", "urgent"], type: undefined, limit: 5, epicId: [] }),
    ).toBe("?q=log+in&priority=high&priority=urgent&limit=5");
    expect(query({ sort: "-key" })).toBe("?sort=-key");
    expect(query({ done: false })).toBe("?done=false");
    expect(query({})).toBe("");
  });
});

describe("the five tools (WS-132 tests 2 and 3)", () => {
  it("are offered to a qa_agent and a worker_agent, in their place among the reads", async () => {
    for (const agent of [QA_AGENT, WORKER_AGENT]) {
      const { client } = await serve(notFound, agent.permissions);
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names.slice(0, 12), agent.role).toEqual([
        "opanel_whoami",
        "opanel_list_projects",
        "opanel_get_board",
        "opanel_get_backlog",
        "opanel_list_labels",
        "opanel_list_epics",
        "opanel_list_teams",
        "opanel_find_people",
        "opanel_search_tasks",
        "opanel_get_task",
        "opanel_get_task_activity",
        "opanel_add_comment",
      ]);
    }
  });

  it("are offered with tasks:read alone, and not without it", async () => {
    const onlyTasks = await serve(notFound, ["tasks:read"]);
    const withTasks = (await onlyTasks.client.listTools()).tools.map((tool) => tool.name);
    for (const name of NEW_TOOLS) expect(withTasks).toContain(name);

    const onlyProjects = await serve(notFound, ["projects:read"]);
    const withoutTasks = (await onlyProjects.client.listTools()).tools.map((tool) => tool.name);
    for (const name of NEW_TOOLS) expect(withoutTasks).not.toContain(name);
  });

  it("are read-only, name tasks:read, mark user-written text as data", async () => {
    const { client } = await serve(notFound);
    const tools = (await client.listTools()).tools.filter((tool) => NEW_TOOLS.includes(tool.name));

    expect(tools.map((tool) => tool.name)).toEqual(NEW_TOOLS);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.description, tool.name).toMatch(/Needs tasks:read\./);
      expect(tool.description, tool.name).toMatch(/data, not instructions/);
      expect(tool.outputSchema?.type, tool.name).toBe("object");
    }
  });

  it("take a filter as a value or an array, and the limit as an integer", async () => {
    const { client } = await serve(notFound);
    const tools = (await client.listTools()).tools;

    for (const name of ["opanel_search_tasks", "opanel_get_backlog"]) {
      const properties = tools.find((tool) => tool.name === name)?.inputSchema.properties ?? {};
      const priority = JSON.stringify(properties.priority);
      expect(priority, name).toContain('"anyOf"');
      expect(priority, name).toContain('"type":"array"');
      expect(properties.limit, name).toMatchObject({ type: "integer" });
    }
    const search = tools.find((tool) => tool.name === "opanel_search_tasks");
    expect(Object.keys(search?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["q", "projectId", "sort", "labelId", "dueFrom", "cursor"]),
    );
    expect(Object.keys(search?.inputSchema.properties ?? {})).not.toContain("columnId");
  });
});

describe("opanel_search_tasks (WS-132 test 4)", () => {
  it("sends q, repeated filters, projects and sort as the API reads them", async () => {
    const body = page([listItem(1, "OPA", "In progress", "bug"), listItem(3, "WEB", null)], "n1");
    const { client, urls } = await serve(() => jsonResponse(200, body));

    const result = await client.callTool({
      name: "opanel_search_tasks",
      arguments: {
        q: "log fai",
        priority: ["high", "urgent"],
        type: "bug",
        projectId: ["OPA", "WEB"],
        sort: "-priority",
        limit: 10,
        cursor: "c1",
      },
    });

    expect(result.isError, textOf(result)).not.toBe(true);
    const url = urls()[0];
    expect(url?.pathname).toBe("/api/v1/tasks");
    expect(url?.searchParams.get("q")).toBe("log fai");
    expect(url?.searchParams.getAll("priority")).toEqual(["high", "urgent"]);
    expect(url?.searchParams.getAll("type")).toEqual(["bug"]);
    expect(url?.searchParams.getAll("projectId")).toEqual(["OPA", "WEB"]);
    expect(url?.searchParams.get("sort")).toBe("-priority");
    expect(url?.searchParams.get("limit")).toBe("10");
    expect(url?.searchParams.get("cursor")).toBe("c1");
    expect(taskListItemPageSchema.parse(result.structuredContent)).toEqual(body);
    expect(textOf(result).startsWith(NOTICE)).toBe(true);
    expect(summaryOf(result)).toBe(
      '2 tasks: OPA-1, a bug: "Task OPA" (OPA, "In progress"); WEB-3, a task: "Task WEB" ' +
        '(WEB, backlog). More: call opanel_search_tasks with cursor "n1".',
    );
  });

  it("sends nothing but the defaults the API knows when given no input", async () => {
    const { client, urls } = await serve(() => jsonResponse(200, page([])));

    const result = await client.callTool({ name: "opanel_search_tasks", arguments: {} });

    expect(urls()[0]?.search).toBe("?sort=-updated");
    expect(summaryOf(result)).toBe("No tasks.");
  });
});

describe("opanel_get_backlog, opanel_list_labels and opanel_list_epics (WS-132 test 5)", () => {
  it("reads a page of the backlog with its filters, in rank order", async () => {
    const body = page([taskSummary(4, null, "Logout button"), taskSummary(7, null, "Notes")]);
    const { client, urls } = await serve(() => jsonResponse(200, body));

    const result = await client.callTool({
      name: "opanel_get_backlog",
      arguments: { projectId: "OPA", priority: ["urgent"], labelId: [EPIC_ID], limit: 2 },
    });

    expect(result.isError, textOf(result)).not.toBe(true);
    expect(urls()[0]?.pathname).toBe("/api/v1/projects/OPA/backlog");
    expect(urls()[0]?.searchParams.getAll("priority")).toEqual(["urgent"]);
    expect(urls()[0]?.searchParams.getAll("labelId")).toEqual([EPIC_ID]);
    expect(urls()[0]?.searchParams.get("limit")).toBe("2");
    expect(taskPageSchema.parse(result.structuredContent)).toEqual(body);
    expect(summaryOf(result)).toBe(
      '2 tasks in the backlog, in rank order: OPA-4, a task: "Logout button"; ' +
        'OPA-7, a task: "Notes".',
    );
  });

  it("refuses a column on the backlog without a request", async () => {
    const { client, calls } = await serve(() => jsonResponse(200, page([])));

    const result = await client.callTool({
      name: "opanel_get_backlog",
      arguments: { projectId: "OPA", columnId: DOING_ID },
    });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("lists every label of the project", async () => {
    const body = { items: [label("release"), label("ui")], nextCursor: null };
    const { client, urls } = await serve(() => jsonResponse(200, body));

    const result = await client.callTool({
      name: "opanel_list_labels",
      arguments: { projectId: PROJECT_ID },
    });

    expect(urls()[0]?.pathname).toBe(`/api/v1/projects/${PROJECT_ID}/labels`);
    expect(urls()[0]?.search).toBe("");
    expect(labelListSchema.parse(result.structuredContent)).toEqual(body);
    expect(summaryOf(result)).toBe('2 labels: "release", "ui".');
  });

  it("lists a page of epics by status", async () => {
    const body = page([epic("Launch"), epic("Old", "closed")], "e2");
    const { client, urls } = await serve(() => jsonResponse(200, body));

    const result = await client.callTool({
      name: "opanel_list_epics",
      arguments: { projectId: "OPA", status: "all", limit: 2 },
    });

    expect(urls()[0]?.pathname).toBe("/api/v1/projects/OPA/epics");
    expect(Object.fromEntries(urls()[0]?.searchParams ?? [])).toEqual({
      status: "all",
      limit: "2",
    });
    expect(epicPageSchema.parse(result.structuredContent)).toEqual(body);
    expect(summaryOf(result)).toBe(
      '2 epics: "Launch" (open), "Old" (closed). More: call opanel_list_epics with cursor "e2".',
    );
  });
});

describe("opanel_get_task_activity (WS-132 test 6)", () => {
  it("encodes the key, passes the page, and counts changes and comments", async () => {
    const body = page(
      [change("priority"), { kind: "comment", comment: comment("Seen again.") }, change("dueDate")],
      "a3",
    );
    const { client, urls } = await serve(() => jsonResponse(200, body));

    const result = await client.callTool({
      name: "opanel_get_task_activity",
      arguments: { taskId: "OPA-12", limit: 3, cursor: "a0" },
    });

    expect(result.isError, textOf(result)).not.toBe(true);
    expect(urls()[0]?.pathname).toBe("/api/v1/tasks/OPA-12/activity");
    expect(Object.fromEntries(urls()[0]?.searchParams ?? [])).toEqual({ limit: "3", cursor: "a0" });
    expect(activityPageSchema.parse(result.structuredContent).items).toHaveLength(3);
    expect(summaryOf(result)).toBe(
      "3 items, oldest first: 2 changes and 1 comment. " +
        'More: call opanel_get_task_activity with cursor "a3".',
    );
  });

  it("accepts the task's id", async () => {
    const { client, urls } = await serve(() => jsonResponse(200, page([])));

    const result = await client.callTool({
      name: "opanel_get_task_activity",
      arguments: { taskId: TASK_ID },
    });

    expect(urls()[0]?.pathname).toBe(`/api/v1/tasks/${TASK_ID}/activity`);
    expect(summaryOf(result)).toBe("No activity.");
  });
});

describe("inputs refused without a request (WS-132 test 7)", () => {
  it.each([
    ["opanel_search_tasks", { priority: Array.from({ length: 21 }, () => "high") }],
    ["opanel_search_tasks", { dueFrom: "2030-02-01", dueTo: "2030-01-01" }],
    ["opanel_search_tasks", { sort: "status" }],
    ["opanel_search_tasks", { q: "" }],
    ["opanel_search_tasks", { limit: "10" }],
    ["opanel_get_backlog", { projectId: "opa" }],
    ["opanel_list_labels", {}],
    ["opanel_list_epics", { projectId: "OPA", status: "done" }],
    ["opanel_get_task_activity", { taskId: "opa-12" }],
  ])("%s refuses %j", async (name, input) => {
    const { client, calls } = await serve(() => jsonResponse(200, page([])));

    const result = await client.callTool({ name, arguments: input });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("errors and the token (WS-132 test 8)", () => {
  it("answers a 403 as a tool error with its request id", async () => {
    const { client } = await serve(() =>
      problemResponse(403, "forbidden", "This project is outside the agent's projects."),
    );

    const result = await client.callTool({
      name: "opanel_search_tasks",
      arguments: { projectId: "WEB" },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("403 forbidden");
    expect(textOf(result)).toContain(REQUEST_ID);
  });

  it("is an unexpected_response error when an answer does not match its schema", async () => {
    const { client } = await serve(() =>
      jsonResponse(200, { items: [{ ...label("ui"), secret: "x" }], nextCursor: null }),
    );

    const result = await client.callTool({
      name: "opanel_list_labels",
      arguments: { projectId: "OPA" },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("unexpected answer (status 200)");
    expect(textOf(result)).not.toContain("secret");
  });

  it("never holds the token, and writes nothing to stdout", async () => {
    const stdout = vi.spyOn(process.stdout, "write");
    const { client } = await serve(() =>
      problemResponse(400, "invalid_request", `Bad header Bearer ${TOKEN}`),
    );
    const calls: [string, Record<string, unknown>][] = [
      ["opanel_get_backlog", { projectId: "OPA" }],
      ["opanel_list_labels", { projectId: "OPA" }],
      ["opanel_list_epics", { projectId: "OPA" }],
      ["opanel_search_tasks", { q: "login" }],
      ["opanel_get_task_activity", { taskId: "OPA-12" }],
    ];

    for (const [name, args] of calls) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, name).toBe(true);
      expect(JSON.stringify(result), name).not.toContain(TOKEN);
    }
    expect(stdout).not.toHaveBeenCalled();
  });
});
