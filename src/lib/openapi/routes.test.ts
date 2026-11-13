// @vitest-environment node
// Route modules are server code: they are imported here, not rendered.
import { globSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { EndpointContract } from "./contract";
import { contracts } from "./contracts";

const API_ROOT = path.join(process.cwd(), "src/app/api");
const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

/**
 * Route files that are deliberately not in the OpenAPI document. The only one is the
 * catch-all that answers unknown paths with a 404 problem body (WS-011): it is the
 * absence of an endpoint, not an endpoint. It is built with `unknownPathRoute`.
 */
const UNDOCUMENTED_ROUTE_FILES = ["[...path]/route.ts"];

/**
 * Operations that need a session but no permission from the catalogue, because they act on
 * the caller's own session or account. Approved as an exception to AGENTS.md rule 6 in
 * WS-015 (question 3) and WS-021 (own name and password). Adding an entry is a decision for
 * a work-spec, not a convenience.
 */
const AUTHENTICATION_ONLY_OPERATIONS = [
  "GET /api/v1/me",
  "POST /api/v1/auth/sign-out",
  "PATCH /api/v1/me",
  "POST /api/v1/me/password",
];

/**
 * Operations a work-spec declared public (AGENTS.md rule 6): health (WS-005), the OpenAPI
 * document (WS-006), sign-in (WS-015), first-run setup (WS-016) and accepting a one-time
 * link (WS-019). Making another operation public is a decision for a work-spec.
 */
const PUBLIC_OPERATIONS = [
  "GET /api/v1/health",
  "GET /api/v1/openapi.json",
  "POST /api/v1/auth/sign-in",
  "POST /api/v1/setup",
  "POST /api/v1/account-links/accept",
];

interface ExportedHandler {
  file: string;
  /** "METHOD /path", the path as OpenAPI writes it. */
  operation: string;
  method: string;
  value: unknown;
}

/** Every route file under src/app/api, as a POSIX path relative to it. */
function routeFiles(): string[] {
  return globSync("**/route.ts", { cwd: API_ROOT })
    .map((file) => file.split(path.sep).join("/"))
    .sort();
}

/** "/api/v1/accounts/{accountId}" for "v1/accounts/[accountId]/route.ts". */
function urlPathOf(file: string): string {
  const segments = path.posix.dirname(file).split("/");
  // Next.js dynamic segments are written [id]; OpenAPI writes them {id}.
  return `/api/${segments.join("/")}`.replace(/\[([^\]]+)\]/g, "{$1}");
}

/** Imports every route module and lists the HTTP method handlers it exports. */
async function exportedHandlers(): Promise<ExportedHandler[]> {
  const handlers: ExportedHandler[] = [];
  for (const file of routeFiles()) {
    const module: Record<string, unknown> = await import(path.join(API_ROOT, file));
    for (const method of HTTP_METHODS) {
      if (method in module) {
        handlers.push({
          file,
          operation: `${method} ${urlPathOf(file)}`,
          method,
          value: module[method],
        });
      }
    }
  }
  return handlers;
}

/** The contract `route()` attached to a handler, if it was built by `route()`. */
function contractOf(value: unknown): EndpointContract | undefined {
  if (typeof value !== "function" || !("contract" in value)) {
    return undefined;
  }
  return value.contract as EndpointContract;
}

function operationOf(contract: EndpointContract): string {
  return `${contract.method.toUpperCase()} ${contract.path}`;
}

function documentedOperations(): string[] {
  return contracts.map(operationOf).sort();
}

describe("API routes and OpenAPI contracts", () => {
  it("finds the route files", async () => {
    const operations = (await exportedHandlers()).map((handler) => handler.operation);

    expect(operations).toContain("GET /api/v1/health");
  });

  it("documents every implemented route, and implements every documented route", async () => {
    const implemented = (await exportedHandlers())
      .filter((handler) => !UNDOCUMENTED_ROUTE_FILES.includes(handler.file))
      .map((handler) => handler.operation)
      .sort();

    expect(
      documentedOperations(),
      "Route handlers and src/lib/openapi/contracts.ts disagree. " +
        "Every exported HTTP method needs a contract, and every contract needs a handler.",
    ).toEqual(implemented);
  });

  it("has no duplicate contracts", () => {
    const documented = documentedOperations();

    expect(new Set(documented).size).toBe(documented.length);
  });

  describe("access is declared, and route() enforces it (AGENTS.md rule 6, WS-025)", () => {
    it("builds every documented handler with route() from the contract of its own method and path", async () => {
      const problems: string[] = [];
      for (const handler of await exportedHandlers()) {
        if (UNDOCUMENTED_ROUTE_FILES.includes(handler.file)) {
          continue;
        }
        const contract = contractOf(handler.value);
        if (contract === undefined) {
          problems.push(
            `${handler.file}: ${handler.method} is not built with route(contract, ...).`,
          );
        } else if (operationOf(contract) !== handler.operation) {
          problems.push(
            `${handler.file}: ${handler.method} is built from the contract of ${operationOf(contract)}.`,
          );
        } else if (!contracts.includes(contract)) {
          problems.push(
            `${handler.file}: ${handler.method} uses a contract that is not in src/lib/openapi/contracts.ts.`,
          );
        }
      }

      expect(problems).toEqual([]);
    });

    it("exempts only the catch-all for unknown paths, which carries no contract", async () => {
      expect(UNDOCUMENTED_ROUTE_FILES).toEqual(["[...path]/route.ts"]);
      const handlers = await exportedHandlers();
      const catchAll = handlers.filter((handler) => handler.file === "[...path]/route.ts");

      expect(catchAll.length).toBeGreaterThan(0);
      for (const handler of catchAll) {
        expect(typeof handler.value, handler.method).toBe("function");
        expect(contractOf(handler.value), handler.method).toBeUndefined();
      }
    });

    it("declares exactly the authentication-only operations of WS-015 and WS-021", () => {
      const authenticated = contracts
        .filter((contract) => contract.access.kind === "authenticated")
        .map(operationOf)
        .sort();

      expect(authenticated).toEqual([...AUTHENTICATION_ONLY_OPERATIONS].sort());
    });

    it("declares exactly the public operations approved by their work-specs", () => {
      const declaredPublic = contracts
        .filter((contract) => contract.access.kind === "public")
        .map(operationOf)
        .sort();

      expect(declaredPublic).toEqual([...PUBLIC_OPERATIONS].sort());
    });
  });
});
