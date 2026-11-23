import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { scopesOfRole } from "@/lib/schemas/agents";
import { AGENT_ROLES, AGENT_SCOPES, type AgentRole } from "@/lib/schemas/permissions";

import { readConfig } from "./config";
import { prepare } from "./start";
import {
  fakeFetch,
  jsonResponse,
  memoryStream,
  problemResponse,
  QA_AGENT,
  TOKEN,
  URL_BASE,
} from "./testing";
import { TOOLS } from "./tools";

// Keeps docs/mcp.md, the operator guide, and the tool table of mcp/README.md in step with
// the server (WS-106 section 5). The package may not import scripts/doc-checks.ts
// (boundaries.test.ts), so the few helpers it needs are here.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const GUIDE_PATH = join(ROOT, "docs", "mcp.md");

function read(path: string): string {
  return existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), "utf8") : "";
}

const guide = read("docs/mcp.md");

const SECTIONS = [
  "What the assistant gets",
  "What you need",
  "The agent account",
  "The token",
  "Claude Code on the command line",
  "Sharing with a team",
  "The desktop app",
  "Checking it works",
  "Troubleshooting",
  "Rotating and revoking",
  "Security",
];

function headings(markdown: string): string[] {
  return [...markdown.matchAll(/^## (.+)$/gm)].map((match) => (match[1] ?? "").trim());
}

function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n## ${heading}\n`);
  if (start < 0) return "";
  const next = markdown.indexOf("\n## ", start + 4);
  return markdown.slice(start, next < 0 ? undefined : next);
}

function codeSpans(markdown: string): string[] {
  return [...markdown.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? "");
}

function codeBlocks(markdown: string, language: string): string[] {
  return [
    ...markdown.matchAll(new RegExp(`^\`\`\`${language}\\r?\\n([\\s\\S]*?)^\`\`\``, "gm")),
  ].map((match) => match[1] ?? "");
}

/** The opening words of a message, as an operator would find it in the guide's table. */
function opening(message: string): string {
  return message.split(" ").slice(0, 6).join(" ");
}

/** What the server writes to stderr at start, with placeholders for the address. */
async function startMessage(
  env: Record<string, string | undefined>,
  respond: () => Response | Promise<Response> = () => jsonResponse(200, QA_AGENT),
): Promise<string> {
  const stderr = memoryStream();
  await prepare({ env, fetch: fakeFetch(respond).fetch, stderr });
  const [first = ""] = stderr.text().split("\n");
  return first
    .replace(/^opanel-mcp: /, "")
    .replaceAll(URL_BASE, "<OPANEL_URL>")
    .replaceAll("opanel.internal", "<host>");
}

const env = { OPANEL_URL: URL_BASE, OPANEL_TOKEN: TOKEN };

describe("docs/mcp.md, the operator guide (WS-106)", () => {
  it("exists, with the sections of WS-106 in order", () => {
    expect(existsSync(GUIDE_PATH)).toBe(true);
    expect(headings(guide)).toEqual(SECTIONS);
  });

  it("names every start-up failure of the server, in the server's own words", async () => {
    const messages = [
      await startMessage({ OPANEL_TOKEN: TOKEN }),
      await startMessage({ OPANEL_URL: URL_BASE }),
      await startMessage(env, () => problemResponse(401, "unauthenticated", "No.")),
      await startMessage(env, () => problemResponse(403, "agent_disabled", "Disabled.")),
      await startMessage(env, () =>
        jsonResponse(200, { ...QA_AGENT, kind: "human", email: "a@example.com", role: "admin" }),
      ),
      await startMessage(env, () => new Response("<html></html>", { status: 200 })),
      await startMessage(env, () => {
        throw new TypeError("fetch failed");
      }),
      await startMessage({ ...env, OPANEL_URL: "http://opanel.internal" }),
    ];
    const troubleshooting = section(guide, "Troubleshooting");

    for (const message of messages) {
      expect(message, "the server wrote nothing").not.toBe("");
      expect(troubleshooting, message).toContain(opening(message));
    }
  });

  it("names only tools, roles, scopes and variables the server has", () => {
    const tools = new Set(TOOLS.map((tool) => tool.name));
    const roles = new Set<string>(AGENT_ROLES);
    const scopes = new Set<string>(AGENT_SCOPES);
    const variables = new Set(Object.keys(env));
    expect(readConfig(env).ok).toBe(true);

    for (const [name] of guide.matchAll(/\bopanel_[a-z_]+/g)) expect(tools, name).toContain(name);
    for (const [name] of guide.matchAll(/\b[a-z]+_agent\b/g)) expect(roles, name).toContain(name);
    for (const span of codeSpans(guide).filter((each) => /^[a-z]+:[a-z]+$/.test(each))) {
      expect(scopes, span).toContain(span);
    }
    for (const [name] of guide.matchAll(/\bOPANEL_[A-Z_]+/g)) {
      expect(variables, name).toContain(name);
    }

    const rows = section(guide, "The agent account")
      .split("\n")
      .filter((line) => line.startsWith("|") && /`[a-z]+_agent`/.test(line));
    expect(rows.length).toBeGreaterThanOrEqual(AGENT_ROLES.length);
    for (const row of rows) {
      const role = /`([a-z]+_agent)`/.exec(row)?.[1] as AgentRole;
      const held = new Set<string>(scopesOfRole(role));
      for (const span of codeSpans(row).filter((each) => /^[a-z]+:[a-z]+$/.test(each))) {
        expect(held, `${role}: ${span}`).toContain(span);
      }
    }
  });

  it("holds no token, and its .mcp.json takes the token from the environment", () => {
    expect(guide).not.toMatch(/opk_[a-z2-7]{12}_[0-9a-f]{64}/);

    const project = codeBlocks(guide, "json").find((block) => block.includes("mcpServers"));
    expect(project).toBeDefined();
    const parsed = JSON.parse(project ?? "{}") as {
      mcpServers?: { opanel?: { command?: string; args?: string[]; env?: Record<string, string> } };
    };
    const server = parsed.mcpServers?.opanel;
    expect(server?.command).toBe("node");
    expect(server?.env).toEqual({
      OPANEL_URL: "${OPANEL_URL}",
      OPANEL_TOKEN: "${OPANEL_TOKEN}",
    });
    expect(server?.args?.at(-1)).toMatch(/mcp\/dist\/index\.js$/);

    const bin = (JSON.parse(read("mcp/package.json")) as { bin: Record<string, string> }).bin;
    expect(bin["opanel-mcp"]).toBe("dist/index.js");
  });

  it("links only to files that exist, and gives claude mcp add its options in order", () => {
    for (const [, target = ""] of guide.matchAll(/\]\(([^)\s]+)\)/g)) {
      const path = target.split("#")[0] ?? "";
      if (path === "" || /^[a-z]+:/.test(path)) continue;
      expect(existsSync(join(dirname(GUIDE_PATH), path)), path).toBe(true);
    }

    const commands = [...codeBlocks(guide, "sh"), ...codeBlocks(guide, "powershell")]
      .join("\n")
      .split("\n")
      .filter((line) => line.startsWith("claude mcp add "));
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      const words = command.trim().split(/\s+/);
      // The name first, as `claude mcp add --help` shows it: after a variadic `-e`, a name
      // would be read as one more variable.
      expect(words[3], command).toBe("opanel");
      const separator = words.indexOf("--");
      expect(separator, command).toBeGreaterThan(3);
      expect(words[separator + 1], command).toBe("node");
      expect(words.at(-1), command).toMatch(/mcp\/dist\/index\.js$/);
    }
  });

  it("is linked from the README, the agents guide and the package's README", () => {
    expect(read("README.md")).toContain("(docs/mcp.md)");
    expect(read("mcp/README.md")).toContain("(../docs/mcp.md)");
    const agents = read("docs/agents.md");
    expect(agents).toContain("(mcp.md)");
    expect(agents).not.toMatch(/will use Opanel through\s+tools/);
  });
});

describe("the tool table of mcp/README.md (WS-106)", () => {
  it("lists every tool, in order, with the permissions it declares", () => {
    const rows = read("mcp/README.md")
      .split("\n")
      .filter((line) => line.startsWith("| `opanel_"))
      .map((line) => {
        const cells = line.split("|").map((cell) => cell.trim());
        const permissions = cells[3] === "none" ? [] : codeSpans(cells[3] ?? "");
        return { name: codeSpans(cells[1] ?? "")[0], permissions };
      });

    expect(rows).toEqual(
      TOOLS.map((tool) => ({ name: tool.name, permissions: [...tool.permissions] })),
    );
  });
});
