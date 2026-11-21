import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The package is a client of /api/v1 that shares only the schemas (WS-099 test 12, doc 0005).

const root = fileURLToPath(new URL("../../", import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (name === "node_modules" || name === "dist") return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mts)$/.test(name) ? [path] : [];
  });
}

function imports(path: string): string[] {
  const text = readFileSync(path, "utf8");
  return [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  );
}

describe("boundaries of the MCP package", () => {
  it("is never imported by the app, its tests or its scripts", () => {
    const offending = ["src", "tests", "scripts"]
      .flatMap((directory) => sourceFiles(join(root, directory)))
      .filter((path) => imports(path).some((target) => /(^|\/)mcp(\/|$)/.test(target)))
      .map((path) => relative(root, path));

    expect(offending).toEqual([]);
  }, 30_000);

  it("imports from the app only its schemas and their OpenAPI helpers", () => {
    const files = sourceFiles(join(root, "mcp", "src"));
    const offending = files
      .flatMap((path) => imports(path).map((target) => ({ path, target })))
      .filter(({ target }) => target.startsWith("@/") || target.includes("../src/"))
      .filter(({ target }) => !/^@\/lib\/(schemas|openapi)\//.test(target))
      .map(({ path, target }) => `${relative(root, path)}: ${target}`);

    expect(files.length).toBeGreaterThan(0);
    expect(offending).toEqual([]);
  });
});
