import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CHECKS, type CheckRun, runChecks } from "./check";

/** A runner whose checks finish only when the test says so. */
function controlledRunner() {
  const started: string[] = [];
  const finish = new Map<string, (run: CheckRun) => void>();
  const run = (name: string) =>
    new Promise<CheckRun>((resolve) => {
      started.push(name);
      finish.set(name, resolve);
    });
  return { started, finish, run };
}

describe("runChecks (WS-103)", () => {
  it("starts every check before any of them finishes", async () => {
    const runner = controlledRunner();
    const printed: string[] = [];

    const done = runChecks(["a", "b", "c"], runner.run, (text) => printed.push(text));
    await Promise.resolve();

    expect(runner.started).toEqual(["a", "b", "c"]);
    expect(printed).toEqual([]);

    for (const name of ["a", "b", "c"]) {
      runner.finish.get(name)?.({ code: 0, output: "", ms: 1 });
    }
    await done;
  });

  it("prints each check's output as one block, in the order they finish", async () => {
    const runner = controlledRunner();
    const printed: string[] = [];

    const done = runChecks(["lint", "typecheck"], runner.run, (text) => printed.push(text));
    await Promise.resolve();
    runner.finish.get("typecheck")?.({ code: 0, output: "no errors\n", ms: 8_200 });
    await Promise.resolve();
    runner.finish.get("lint")?.({ code: 0, output: "", ms: 61_000 });
    await done;

    expect(printed[0]).toBe("── typecheck: passed in 8.2 s ──\nno errors\n");
    expect(printed[1]).toBe("── lint: passed in 61.0 s ──\n");
  });

  it("returns 1 and names the failed checks when any fails", async () => {
    const printed: string[] = [];
    const run = (name: string) =>
      Promise.resolve<CheckRun>({ code: name === "lint" ? 2 : 0, output: "", ms: 10 });

    const code = await runChecks(["typecheck", "lint", "format:check"], run, (text) =>
      printed.push(text),
    );

    expect(code).toBe(1);
    expect(printed).toContain("── lint: failed (exit 2) in 0.0 s ──\n");
    expect(printed.at(-1)).toBe("Failed: lint");
  });

  it("returns 0 and says so when every check passes", async () => {
    const printed: string[] = [];
    const run = () => Promise.resolve<CheckRun>({ code: 0, output: "", ms: 10 });

    const code = await runChecks(["typecheck", "lint"], run, (text) => printed.push(text));

    expect(code).toBe(0);
    expect(printed.at(-1)).toBe("All passed: typecheck, lint");
  });

  it("runs only scripts that package.json defines", () => {
    const scripts = (
      JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }
    ).scripts;

    expect(CHECKS).toEqual(["typecheck", "lint", "format:check"]);
    for (const name of CHECKS) {
      expect(scripts[name], name).toBeDefined();
    }
    expect(scripts.check).toBe("tsx scripts/check.ts");
  });
});
