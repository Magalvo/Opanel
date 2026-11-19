// Keeps docs/operations.md in step with the image, the env files and the repository
// (WS-070 section 5). It does not run the guide's commands: the scripts of the image
// workflow run the same ones.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  guideProblems,
  read,
  type Repository,
  ROOT,
  sectionHeadings,
  thisRepository,
} from "./doc-checks";

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
