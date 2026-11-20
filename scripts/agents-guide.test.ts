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
} from "@/lib/schemas/bug-reports";
import { AGENT_SCOPES } from "@/lib/schemas/permissions";
import { PROBLEM_CODES } from "@/lib/schemas/problem";

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

  it("is linked from the README and from the OpenAPI document", () => {
    expect(read("README.md")).toContain("](docs/agents.md)");
    expect(buildOpenApiDocument().info.description).toContain("docs/agents.md");
  });
});
