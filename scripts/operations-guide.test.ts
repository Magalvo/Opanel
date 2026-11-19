// Keeps docs/operations.md in step with the image, the env files and the repository
// (WS-070 section 5). It does not run the guide's commands: the scripts of the image
// workflow run the same ones.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const GUIDE = join(ROOT, "docs", "operations.md");

const SECTIONS = [
  "Before you start",
  "Install",
  "Reverse proxy and HTTPS",
  "Upgrade",
  "Backup and restore",
  "Recovering the last Admin",
  "Maintenance",
  "Health and outages",
  "Storage",
  "Logs",
];

interface Repository {
  /** The runtime stage of the Dockerfile copies these `dist/*.mjs` commands. */
  readonly shippedCommands: ReadonlySet<string>;
  /** Variables the app reads and an env example describes, or the Compose file reads. */
  readonly knownVariables: ReadonlySet<string>;
  /** Whether a path, relative to the repository root, exists. */
  readonly exists: (path: string) => boolean;
}

const VARIABLE = /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/;
const REPOSITORY_PATH =
  /^(?:(?:docs|scripts|src|docker|\.github)\/[^\s*<>{}]+|[\w.-]+\.(?:ya?ml|md|example|json)|Dockerfile)$/;

function codeSpans(markdown: string): string[] {
  return [...markdown.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? "");
}

function bashBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/^```bash\r?\n([\s\S]*?)^```/gm)].map((match) => match[1] ?? "");
}

/** Every problem the guide has against the repository; empty when it is in step. */
function guideProblems(guide: string, repository: Repository): string[] {
  const problems = new Set<string>();

  for (const match of guide.matchAll(/\bdist\/([\w-]+)\.mjs\b/g)) {
    const command = match[1] ?? "";
    if (!repository.shippedCommands.has(command)) {
      problems.add(`the image does not ship dist/${command}.mjs`);
    }
  }

  const variables = new Set<string>();
  for (const span of codeSpans(guide)) {
    const name = span.split("=")[0] ?? "";
    if (VARIABLE.test(name)) {
      variables.add(name);
    }
  }
  for (const block of bashBlocks(guide)) {
    for (const match of block.matchAll(/(?:^|\s)([A-Z][A-Z0-9]*_[A-Z0-9_]+)=/gm)) {
      variables.add(match[1] ?? "");
    }
  }
  for (const name of variables) {
    if (!repository.knownVariables.has(name)) {
      problems.add(`unknown variable ${name}`);
    }
  }

  for (const span of codeSpans(guide)) {
    if (REPOSITORY_PATH.test(span) && !repository.exists(span)) {
      problems.add(`missing file ${span}`);
    }
  }
  for (const match of guide.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = (match[1] ?? "").split("#")[0] ?? "";
    if (target === "" || /^[a-z]+:/.test(target)) {
      continue;
    }
    const path = join("docs", target).replaceAll("\\", "/");
    if (!repository.exists(path)) {
      problems.add(`broken link ${target}`);
    }
  }

  return [...problems];
}

function sectionHeadings(guide: string): string[] {
  return [...guide.matchAll(/^## (.+)$/gm)].map((match) => (match[1] ?? "").trim());
}

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function thisRepository(): Repository {
  const dockerfile = read("Dockerfile");
  const runtime = dockerfile.slice(dockerfile.indexOf("AS runtime"));
  const shippedCommands = new Set(
    [...runtime.matchAll(/\/app\/dist\/([\w-]+)\.mjs/g)].map((match) => match[1] ?? ""),
  );

  // The keys of the env schema, read from its source: the app does not export it.
  const envSource = read("src/server/env.ts");
  const schema = envSource.slice(envSource.indexOf("const envSchema"));
  const appVariables = [...schema.matchAll(/^ {2}([A-Z][A-Z0-9_]*): z/gm)].map(
    (match) => match[1] ?? "",
  );
  const examples = read(".env.example") + read(".env.production.example");
  const compose = read("compose.production.yaml");
  const composeVariables = [...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map(
    (match) => match[1] ?? "",
  );
  // Read by PostgreSQL's image and its init script, from the same env file as the app.
  const databaseVariables = ["POSTGRES_PASSWORD", "OPANEL_APP_DB_PASSWORD"].filter((name) =>
    examples.includes(`${name}=`),
  );

  return {
    shippedCommands,
    knownVariables: new Set([
      ...appVariables.filter((name) => examples.includes(name)),
      ...composeVariables,
      ...databaseVariables,
    ]),
    exists: (path) => existsSync(join(ROOT, path)),
  };
}

describe("guideProblems (WS-070)", () => {
  const repository: Repository = {
    shippedCommands: new Set(["migrate"]),
    knownVariables: new Set(["APP_URL"]),
    exists: (path) => ["docs/operations.md", "compose.production.yaml"].includes(path),
  };

  it("finds nothing in a guide that matches the repository", () => {
    const guide = [
      "Run `node dist/migrate.mjs`, set `APP_URL`, read `compose.production.yaml`",
      "and [this guide](operations.md#install), or [Docker](https://docs.docker.com).",
      "",
      "```bash",
      "APP_URL=https://opanel.example.com docker compose up -d",
      "```",
    ].join("\n");

    expect(guideProblems(guide, repository)).toEqual([]);
  });

  it("names a command the image does not ship", () => {
    expect(guideProblems("`node dist/nope.mjs`", repository)).toEqual([
      "the image does not ship dist/nope.mjs",
    ]);
  });

  it("names an unknown variable, in prose or in a command", () => {
    const guide = ["Set `NOT_A_SETTING=1`.", "```bash", "OTHER_THING=2 docker compose up", "```"];

    expect(guideProblems(guide.join("\n"), repository)).toEqual([
      "unknown variable NOT_A_SETTING",
      "unknown variable OTHER_THING",
    ]);
  });

  it("names a missing file and a broken link", () => {
    const guide = "See `docker/nope/Caddyfile` and [the spec](work-specs/WS-999-nope.md).";

    expect(guideProblems(guide, repository)).toEqual([
      "missing file docker/nope/Caddyfile",
      "broken link work-specs/WS-999-nope.md",
    ]);
  });

  it("ignores words in capitals and URL paths", () => {
    expect(
      guideProblems("`TRUNCATE`, `GET /api/v1/health`, `.env.production`", repository),
    ).toEqual([]);
  });
});

describe("docs/operations.md (WS-070)", () => {
  it("exists", () => {
    expect(existsSync(GUIDE)).toBe(true);
  });

  it("has the sections of WS-070, in order", () => {
    expect(sectionHeadings(readFileSync(GUIDE, "utf8"))).toEqual(SECTIONS);
  });

  it("names only commands, variables and files that exist", () => {
    expect(guideProblems(readFileSync(GUIDE, "utf8"), thisRepository())).toEqual([]);
  });

  it("is linked from the README", () => {
    expect(read("README.md")).toContain("](docs/operations.md)");
  });
});
