// Keeps docs/agents.md, the guide for agent authors, in step with the API (WS-078
// section 5): the endpoints it names exist, its error codes and scopes are real, its links
// resolve.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { contracts } from "@/lib/openapi/contracts";
import { buildOpenApiDocument } from "@/lib/openapi/document";
import {
  BUG_REPORT_OUTCOMES,
  ORIGIN_LAYERS,
  submitBugReportRequestSchema,
  TASK_LINK_TYPES,
} from "@/lib/schemas/bug-reports";
import { AGENT_SCOPES } from "@/lib/schemas/permissions";
import { PROBLEM_CODES } from "@/lib/schemas/problem";
import { PRIORITIES, TASK_SORTS, taskFilterShape } from "@/lib/schemas/tasks";

import {
  codeSpans,
  guideProblems,
  read,
  ROOT,
  sectionHeadings,
  thisRepository,
} from "./doc-checks";

const GUIDE = join(ROOT, "docs", "agents.md");

const SECTIONS = [
  "What an agent is",
  "Getting a token",
  "Sending it",
  "What a token can do",
  "Knowing yourself",
  "Errors and limits",
  "Lists",
  "Tasks and the backlog",
  "Finding tasks",
  "Sub-tasks and links",
  "Live updates",
  "Filing bug reports",
  "Rotating and revoking",
  "The contract",
  "What comes next",
];

/** The text of one `## ` section, without its heading. */
function section(guide: string, heading: string): string {
  const start = guide.indexOf(`\n## ${heading}`);
  if (start < 0) return "";
  const next = guide.indexOf("\n## ", start + 4);
  return guide.slice(start, next < 0 ? undefined : next);
}

/** The text of the bullet that starts with `**label**` in `markdown`, up to the next bullet. */
function bullet(markdown: string, label: string): string {
  const start = markdown.indexOf(`- **${label}**`);
  if (start < 0) return "";
  const next = markdown.indexOf("\n- ", start + 2);
  const end = markdown.indexOf("\n\n", start);
  const stops = [next, end].filter((index) => index >= 0);
  return markdown.slice(start, stops.length === 0 ? undefined : Math.min(...stops));
}

/** Code spans that look like a parameter or a field name: `projectId`, `dueFrom`, `key`. */
function names(markdown: string): string[] {
  return codeSpans(markdown).filter((span) => /^[a-z][A-Za-z]*$/.test(span));
}

/** `METHOD /api/v1/…` that no contract matches; `{…}` or an example may fill a parameter. */
function unknownEndpoints(guide: string): string[] {
  const known = contracts.map((contract) => ({
    method: contract.method.toUpperCase(),
    path: new RegExp(`^${contract.path.replace(/\{[^}]+\}/g, "[^/]+")}$`),
  }));
  const unknown = new Set<string>();
  for (const match of guide.matchAll(/\b(GET|POST|PATCH|DELETE) (\/api\/v1\/[^\s`)'"]+)/g)) {
    const [, method = "", target = ""] = match;
    const path = target.split("?")[0] ?? "";
    if (!known.some((endpoint) => endpoint.method === method && endpoint.path.test(path))) {
      unknown.add(`${method} ${path}`);
    }
  }
  return [...unknown];
}

describe("unknownEndpoints (WS-078)", () => {
  it("accepts a contract's path with its parameters or with an example, and a query", () => {
    expect(
      unknownEndpoints(
        "`GET /api/v1/me`, `GET /api/v1/projects/{projectId}/events`, `GET /api/v1/projects/OPA?limit=10`",
      ),
    ).toEqual([]);
  });

  it("names a path or a method the API does not have", () => {
    expect(unknownEndpoints("`GET /api/v1/nope` and `DELETE /api/v1/me`")).toEqual([
      "GET /api/v1/nope",
      "DELETE /api/v1/me",
    ]);
  });
});

describe("docs/agents.md (WS-078)", () => {
  const guide = () => readFileSync(GUIDE, "utf8");

  it("exists", () => {
    expect(existsSync(GUIDE)).toBe(true);
  });

  it("has the sections of WS-078, in order", () => {
    expect(sectionHeadings(guide())).toEqual(SECTIONS);
  });

  it("names only endpoints of the API", () => {
    expect(unknownEndpoints(guide())).toEqual([]);
  });

  it("names only real problem codes in its errors section", () => {
    const codes = codeSpans(section(guide(), "Errors and limits")).filter((span) =>
      /^[a-z]+(_[a-z]+)+$/.test(span),
    );
    expect(codes.length).toBeGreaterThan(3);
    expect(codes.filter((code) => !(PROBLEM_CODES as readonly string[]).includes(code))).toEqual(
      [],
    );
  });

  it("lists exactly the agent scopes", () => {
    const scopes = codeSpans(section(guide(), "What a token can do")).filter((span) =>
      /^[a-z]+:[a-z_]+$/.test(span),
    );
    expect(new Set(scopes)).toEqual(new Set(AGENT_SCOPES));
  });

  it("lists exactly the origin layers in its bug report section, each in a table row (WS-094)", () => {
    const filing = section(guide(), "Filing bug reports");
    const layers = codeSpans(filing).filter((span) =>
      (ORIGIN_LAYERS as readonly string[]).includes(span),
    );
    expect(new Set(layers)).toEqual(new Set(ORIGIN_LAYERS));
    for (const layer of ORIGIN_LAYERS) {
      expect(filing).toMatch(new RegExp(`^\| \`${layer}\` +\|`, "m"));
    }
  });

  it("names both outcomes of a bug report (WS-094)", () => {
    const spans = codeSpans(section(guide(), "Filing bug reports"));
    for (const outcome of BUG_REPORT_OUTCOMES) {
      expect(spans).toContain(outcome);
    }
  });

  it("has an example body the bug report endpoint accepts (WS-094)", () => {
    const example = /^```json\r?\n([\s\S]*?)^```/m.exec(section(guide(), "Filing bug reports"));
    expect(example).not.toBeNull();
    const body: unknown = JSON.parse(example?.[1] ?? "");
    expect(submitBugReportRequestSchema.safeParse(body).success).toBe(true);
  });

  it("promises nothing as not yet done (WS-094)", () => {
    expect(guide()).not.toMatch(/not yet/i);
  });

  it("has no broken link or missing file", () => {
    expect(guideProblems(guide(), thisRepository())).toEqual([]);
  });

  it("lists exactly the task priorities in its tasks section (WS-115)", () => {
    const tasks = section(guide(), "Tasks and the backlog");
    const priorities = codeSpans(tasks).filter((span) =>
      (PRIORITIES as readonly string[]).includes(span),
    );
    expect(priorities.length).toBeGreaterThan(0);
    expect(new Set(priorities)).toEqual(new Set(PRIORITIES));
  });

  it("names the backlog endpoint and the label event (WS-115)", () => {
    expect(guide()).toContain("GET /api/v1/projects/{projectId}/backlog");
    expect(codeSpans(section(guide(), "Live updates"))).toContain("label.changed");
  });

  it("is linked from the README and from the OpenAPI document", () => {
    expect(read("README.md")).toContain("](docs/agents.md)");
    expect(buildOpenApiDocument().info.description).toContain("docs/agents.md");
  });

  it("lists exactly the API's filter parameters in its search section (WS-131)", () => {
    const filters = bullet(section(guide(), "Finding tasks"), "Filters.");
    const parameters = names(filters).filter((name) => name !== "none" && name !== "me");
    expect(new Set(parameters)).toEqual(
      // `q` has its own bullet, "Text search".
      new Set([
        ...Object.keys(taskFilterShape).filter((key) => key !== "q"),
        "columnId",
        "projectId",
      ]),
    );
    expect(codeSpans(filters)).toEqual(expect.arrayContaining(["none", "me"]));
  });

  it("lists exactly the sort fields of the list across projects (WS-131)", () => {
    const order = bullet(section(guide(), "Finding tasks"), "Order.");
    expect(new Set(names(order).filter((name) => name !== "sort"))).toEqual(new Set(TASK_SORTS));
    expect(codeSpans(order)).toContain("-updated");
  });

  it("names the list across projects and a task's activity (WS-131)", () => {
    const finding = section(guide(), "Finding tasks");
    expect(finding).toContain("GET /api/v1/tasks?");
    expect(finding).toContain("GET /api/v1/tasks/{taskId}/activity");
    expect(codeSpans(finding)).toContain("q");
  });

  it("lists exactly the link types, each in a table row (WS-138)", () => {
    const rows = [...section(guide(), "Sub-tasks and links").matchAll(/^\| `([a-z_]+)` +\|/gm)].map(
      (match) => match[1],
    );
    expect(rows).toEqual([...TASK_LINK_TYPES]);
  });

  it("names both link endpoints (WS-138)", () => {
    const links = section(guide(), "Sub-tasks and links");
    expect(links).toContain("POST /api/v1/tasks/{taskId}/links");
    expect(links).toContain("DELETE /api/v1/tasks/{taskId}/links");
    expect(codeSpans(links)).toEqual(expect.arrayContaining(["parentId", "tasks:write"]));
  });

  it("names only real problem codes, and the four of sub-tasks and links (WS-138)", () => {
    // "`409 link_exists`" is a status and a code in one span.
    const codes = codeSpans(section(guide(), "Sub-tasks and links"))
      .flatMap((span) => span.split(" "))
      .filter(
        (span) =>
          /^[a-z]+(_[a-z]+)+$/.test(span) && !(TASK_LINK_TYPES as readonly string[]).includes(span),
      );
    expect(codes.filter((code) => !(PROBLEM_CODES as readonly string[]).includes(code))).toEqual(
      [],
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        "has_subtasks",
        "too_many_subtasks",
        "link_exists",
        "too_many_links",
      ]),
    );
  });
});
