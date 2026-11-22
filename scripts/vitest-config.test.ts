import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import config, { DOM_TEST_FILES, INTEGRATION_WORKERS } from "../vitest.config";

interface Project {
  test?: {
    name?: string;
    environment?: string;
    include?: string[];
    exclude?: string[];
    setupFiles?: string[];
    fileParallelism?: boolean;
    maxWorkers?: number;
  };
}

function project(name: string): NonNullable<Project["test"]> {
  const projects = (config as { test?: { projects?: Project[] } }).test?.projects ?? [];
  const found = projects.find((candidate) => candidate.test?.name === name)?.test;
  if (!found) throw new Error(`no project ${name}`);
  return found;
}

describe("vitest.config.ts (WS-097)", () => {
  it("runs the .ts unit tests in Node, never a .tsx file", () => {
    const unit = project("unit");
    expect(unit.environment).toBe("node");
    expect(unit.include).toEqual(["src/**/*.test.ts", "scripts/**/*.test.ts"]);
    expect(unit.exclude).toEqual(expect.arrayContaining([...DOM_TEST_FILES]));
    expect(unit.setupFiles).toEqual(["./vitest.setup.ts"]);
  });

  it("runs the .tsx tests and the listed .ts files under jsdom", () => {
    const ui = project("ui");
    expect(ui.environment).toBe("jsdom");
    expect(ui.include).toEqual(["src/**/*.test.tsx", ...DOM_TEST_FILES]);
    expect(ui.setupFiles).toEqual(["./vitest.setup.ts", "./vitest.setup.dom.ts"]);
    expect(DOM_TEST_FILES).toEqual(["src/components/board/keyboard.test.ts"]);
  });

  it("runs integration files in parallel on a fixed number of workers", () => {
    const integration = project("integration");
    expect(integration.fileParallelism).not.toBe(false);
    expect(INTEGRATION_WORKERS).toBe(4);
    expect(integration.maxWorkers).toBe(INTEGRATION_WORKERS);
  });

  it("pnpm test:unit runs both unit projects", () => {
    const scripts = (
      JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }
    ).scripts;
    expect(scripts["test:unit"]).toBe("vitest run --project unit --project ui");
  });
});
