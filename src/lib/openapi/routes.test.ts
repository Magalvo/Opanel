import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { contracts } from "./contracts";
import { exportedHandlers, missingChecks } from "./route-checks";

const API_ROOT = path.join(process.cwd(), "src/app/api");
const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

/**
 * Route files that are deliberately not in the OpenAPI document. The only one is the
 * catch-all that answers unknown paths with a 404 problem body (WS-011): it is the
 * absence of an endpoint, not an endpoint.
 */
const UNDOCUMENTED_ROUTE_FILES = ["[...path]/route.ts"];

/**
 * Operations that need a session but no permission from the catalogue, because they act on
 * the caller's own session. Approved as an exception to AGENTS.md rule 6 in WS-015
 * (question 3). Adding an entry is a decision for a work-spec, not a convenience.
 */
const AUTHENTICATION_ONLY_OPERATIONS = ["GET /api/v1/me", "POST /api/v1/auth/sign-out"];

/** "/api/v1/accounts/{accountId}" for "v1/accounts/[accountId]/route.ts". */
function urlPathOf(file: string): string {
  const segments = path.posix.dirname(file).split("/");
  // Next.js dynamic segments are written [id]; OpenAPI writes them {id}.
  return `/api/${segments.join("/")}`.replace(/\[([^\]]+)\]/g, "{$1}");
}

/** What every documented route handler is missing, as readable messages. */
function missingChecksEverywhere(): string[] {
  const problems: string[] = [];
  for (const file of routeFiles()) {
    if (UNDOCUMENTED_ROUTE_FILES.includes(file)) {
      continue;
    }
    const source = readFileSync(path.join(API_ROOT, file), "utf8");
    for (const handler of exportedHandlers(source)) {
      const operation = `${handler.method} ${urlPathOf(file)}`;
      const contract = contracts.find(
        (candidate) => `${candidate.method.toUpperCase()} ${candidate.path}` === operation,
      );
      if (!contract) {
        // Reported by "documents every implemented route" below.
        continue;
      }
      problems.push(
        ...missingChecks({
          file,
          method: handler.method,
          source: handler.source,
          isPublic: contract.public,
          authenticationOnly: AUTHENTICATION_ONLY_OPERATIONS.includes(operation),
        }),
      );
    }
  }
  return problems;
}

/** Every route file under src/app/api, as a POSIX path relative to it. */
function routeFiles(): string[] {
  return globSync("**/route.ts", { cwd: API_ROOT }).map((file) => file.split(path.sep).join("/"));
}

/** "METHOD /path" for every HTTP method exported by a route file under src/app/api. */
function implementedOperations(): string[] {
  const operations: string[] = [];
  for (const file of routeFiles()) {
    if (UNDOCUMENTED_ROUTE_FILES.includes(file)) {
      continue;
    }
    const source = readFileSync(path.join(API_ROOT, file), "utf8");
    const urlPath = urlPathOf(file);
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

  it("exempts only the catch-all for unknown paths, and that file exists", () => {
    expect(UNDOCUMENTED_ROUTE_FILES).toEqual(["[...path]/route.ts"]);
    expect(routeFiles()).toContain("[...path]/route.ts");
    expect(implementedOperations().some((operation) => operation.includes("{...path}"))).toBe(
      false,
    );
  });

  it("has no duplicate contracts", () => {
    const documented = documentedOperations();

    expect(new Set(documented).size).toBe(documented.length);
  });

  describe("checks every handler must make (AGENTS.md rule 6, canonical doc 0004 section 7)", () => {
    it("every handler authenticates, checks a permission and checks the origin where required", () => {
      expect(missingChecksEverywhere()).toEqual([]);
    });

    it("looks at every documented operation", () => {
      const seen = routeFiles()
        .filter((file) => !UNDOCUMENTED_ROUTE_FILES.includes(file))
        .flatMap((file) =>
          exportedHandlers(readFileSync(path.join(API_ROOT, file), "utf8")).map(
            (handler) => `${handler.method} ${urlPathOf(file)}`,
          ),
        )
        .sort();

      expect(seen).toEqual(documentedOperations());
    });

    it("exempts exactly the two authentication-only operations of WS-015", () => {
      expect(AUTHENTICATION_ONLY_OPERATIONS).toEqual([
        "GET /api/v1/me",
        "POST /api/v1/auth/sign-out",
      ]);
      for (const operation of AUTHENTICATION_ONLY_OPERATIONS) {
        expect(documentedOperations()).toContain(operation);
      }
    });
  });
});
