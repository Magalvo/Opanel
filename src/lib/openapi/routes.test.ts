import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { contracts } from "./contracts";

const API_ROOT = path.join(process.cwd(), "src/app/api");
const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/** "METHOD /path" for every HTTP method exported by a route file under src/app/api. */
function implementedOperations(): string[] {
  const operations: string[] = [];
  for (const file of globSync("**/route.ts", { cwd: API_ROOT })) {
    const source = readFileSync(path.join(API_ROOT, file), "utf8");
    const segments = path.dirname(file).split(path.sep);
    // Next.js dynamic segments are written [id]; OpenAPI writes them {id}.
    const urlPath = `/api/${segments.join("/")}`.replace(/\[([^\]]+)\]/g, "{$1}");
    for (const method of HTTP_METHODS) {
      const exported = new RegExp(
        `export\\s+(?:async\\s+)?function\\s+${method}\\b|export\\s+const\\s+${method}\\b`,
      );
      if (exported.test(source)) {
        operations.push(`${method} ${urlPath}`);
      }
    }
  }
  return operations.sort();
}

function documentedOperations(): string[] {
  return contracts.map((contract) => `${contract.method.toUpperCase()} ${contract.path}`).sort();
}

describe("API routes and OpenAPI contracts", () => {
  it("finds the route files", () => {
    expect(implementedOperations()).toContain("GET /api/v1/health");
  });

  it("documents every implemented route, and implements every documented route", () => {
    expect(
      documentedOperations(),
      "Route handlers and src/lib/openapi/contracts.ts disagree. " +
        "Every exported HTTP method needs a contract, and every contract needs a handler.",
    ).toEqual(implementedOperations());
  });

  it("has no duplicate contracts", () => {
    const documented = documentedOperations();

    expect(new Set(documented).size).toBe(documented.length);
  });
});
