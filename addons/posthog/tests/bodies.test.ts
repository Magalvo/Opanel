import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { submitBugReportRequestSchema } from "@/lib/schemas/bug-reports";

import { isPlainPath, type Json, placeholders, readJson, render } from "./render";

// WS-092 section 4, tests 1 to 7: the webhook bodies an operator pastes into PostHog,
// rendered with alert events built from PostHog's documented properties, satisfy Opanel's
// bug report contract, and the add-on stays apart from the app.

const addon = new URL("../", import.meta.url);
const repo = new URL("../../../", import.meta.url);

const body = (name: string) => readJson(new URL(`bodies/body-${name}.json`, addon));
const fixture = (name: string) => readJson(new URL(`fixtures/${name}.json`, addon));

// Which alerts each body is set up for (WS-092 section 2).
const USES = {
  unknown: ["created-web", "created-node", "reopened-web", "spiking"],
  frontend: ["created-web", "reopened-web"],
  backend: ["created-node"],
} as const;
const BODIES = Object.keys(USES) as (keyof typeof USES)[];

const parse = (name: keyof typeof USES, event: string) =>
  submitBugReportRequestSchema.parse(render(body(name), fixture(event)));

function filesUnder(url: URL): string[] {
  const root = fileURLToPath(url);
  const skip = new Set(["node_modules", "test-results", "playwright-report"]);
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      if (skip.has(name)) return [];
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  return walk(root);
}

describe("the PostHog webhook bodies", () => {
  it.each(BODIES.flatMap((name) => USES[name].map((event) => [name, event] as const)))(
    "body-%s.json rendered with %s is a valid bug report",
    (name, event) => {
      const report = parse(name, event);
      expect(report.title.length).toBeGreaterThan(0);
      expect(report.summary).toContain("/error-tracking/fingerprint/");
    },
  );

  it.each(BODIES)("body-%s.json uses only plain placeholders the fixtures define", (name) => {
    const used = placeholders(body(name));
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((expression) => !isPlainPath(expression))).toEqual([]);
    for (const event of USES[name]) expect(() => render(body(name), fixture(event))).not.toThrow();
  });

  it("gives every alert of one issue the same fingerprint, and other issues another", () => {
    const fingerprints = BODIES.flatMap((name) =>
      USES[name].map((event) => ({ event, fingerprint: parse(name, event).fingerprint })),
    );
    const ofIssue = (events: string[]) =>
      new Set(fingerprints.filter((f) => events.includes(f.event)).map((f) => f.fingerprint));

    expect(ofIssue(["created-web", "reopened-web", "spiking"]).size).toBe(1);
    expect(ofIssue(["created-node"]).size).toBe(1);
    expect([...ofIssue(["created-web"])][0]).not.toBe([...ofIssue(["created-node"])][0]);
    for (const { fingerprint } of fingerprints) {
      expect(fingerprint).toMatch(/^posthog:4211:[0-9a-f-]{36}$/);
      expect(fingerprint.length).toBeLessThanOrEqual(128);
    }
  });

  it("differs between PostHog projects for the same issue id", () => {
    const other = fixture("created-web") as { project: Record<string, Json> };
    other.project.id = 9;
    const here = submitBugReportRequestSchema.parse(
      render(body("unknown"), fixture("created-web")),
    );
    const there = submitBugReportRequestSchema.parse(render(body("unknown"), other));
    expect(here.fingerprint).not.toBe(there.fingerprint);
  });

  it("sets the layer and confidence of section 2", () => {
    expect(parse("frontend", "created-web")).toMatchObject({
      originLayer: "frontend",
      confidence: 0.6,
    });
    expect(parse("backend", "created-node")).toMatchObject({
      originLayer: "backend",
      confidence: 0.5,
    });
    const unknown = parse("unknown", "spiking");
    expect(unknown.originLayer).toBe("unknown");
    expect(unknown.confidence).toBeUndefined();
  });

  it("refuses a title over 200 characters, the limit the guide warns about", () => {
    const rendered = render(body("frontend"), fixture("created-long-name"));
    expect(submitBugReportRequestSchema.safeParse(rendered).success).toBe(false);
  });
});

describe("the add-on stays apart from the app and holds no secret", () => {
  it("holds nothing that looks like an Opanel token", () => {
    const tokenLike = /opk_[A-Za-z0-9]{8,}/;
    const offenders = filesUnder(addon).filter((file) =>
      tokenLike.test(readFileSync(file, "utf8")),
    );
    expect(offenders.map((file) => relative(fileURLToPath(repo), file))).toEqual([]);
  });

  it("is never imported by the app, its tests or its scripts", () => {
    const fromAddons = /from\s+["'][^"']*addons\//;
    const offenders = ["src/", "tests/", "scripts/"]
      .flatMap((dir) => filesUnder(new URL(dir, repo)))
      .filter((file) => /\.(ts|tsx|mjs|js)$/.test(file))
      .filter((file) => fromAddons.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => relative(fileURLToPath(repo), file))).toEqual([]);
  }, 30_000);

  it("is left out of the app's type check and of its image", () => {
    const tsconfig = JSON.parse(readFileSync(new URL("tsconfig.json", repo), "utf8")) as {
      exclude?: string[];
    };
    expect(tsconfig.exclude).toContain("addons");
    const dockerignore = readFileSync(new URL(".dockerignore", repo), "utf8").split(/\r?\n/);
    expect(dockerignore).toContain("addons");
  });
});
