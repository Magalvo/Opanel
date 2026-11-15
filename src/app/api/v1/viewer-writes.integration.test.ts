// A Viewer reads and writes nothing (WT-03 exit criteria, WS-039 question 6): every write
// operation of the API is tried with a Viewer's session and must answer 403. `route()` checks
// the permission before it reads the path or the body, so a bare request is enough.
import { globSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";
import { apiRequest, createTestAccount, signInCookie } from "@/server/auth/testing";

const API_ROOT = path.join(process.cwd(), "src/app/api");
const WRITE_METHODS = ["POST", "PATCH", "PUT", "DELETE"] as const;

/** Operations that a Viewer may call: the caller's own account, which needs no permission. */
const OWN_ACCOUNT_OPERATIONS = [
  "POST /api/v1/auth/sign-out",
  "PATCH /api/v1/me",
  "POST /api/v1/me/password",
];

type Handler = (request: Request, context: { params: Promise<unknown> }) => Promise<Response>;

interface WriteOperation {
  operation: string;
  handler: Handler;
  access: EndpointContract["access"];
}

function isHandler(value: unknown): value is Handler & { contract: EndpointContract } {
  return typeof value === "function" && "contract" in value;
}

async function writeOperations(): Promise<WriteOperation[]> {
  const found: WriteOperation[] = [];
  for (const file of globSync("**/route.ts", { cwd: API_ROOT })) {
    const exports = z
      .record(z.string(), z.unknown())
      .parse(await import(path.join(API_ROOT, file)));
    for (const method of WRITE_METHODS) {
      const handler = exports[method];
      if (isHandler(handler)) {
        found.push({
          operation: `${method} ${handler.contract.path}`,
          handler,
          access: handler.contract.access,
        });
      }
    }
  }
  return found.sort((a, b) => a.operation.localeCompare(b.operation));
}

describe("a Viewer cannot write anything", () => {
  it("is refused with 403 by every write operation that needs a permission", async () => {
    await createTestAccount({ email: "viewer@example.com", role: "viewer" });
    const cookie = await signInCookie("viewer@example.com");
    const operations = (await writeOperations()).filter(
      (item) =>
        item.access.kind === "permission" && !OWN_ACCOUNT_OPERATIONS.includes(item.operation),
    );
    // More than a handful, so an empty or broken search cannot pass for success.
    expect(operations.length).toBeGreaterThan(20);

    const answers: Record<string, number> = {};
    for (const { operation, handler } of operations) {
      const response = await handler(
        apiRequest(operation.split(" ")[0] as "POST", "/api/v1/anything", {
          cookie,
          body: {},
        }),
        { params: Promise.resolve({}) },
      );
      answers[operation] = response.status;
    }

    expect(answers).toEqual(Object.fromEntries(operations.map((item) => [item.operation, 403])));
  });

  it("covers the write operations of tasks, comments, epics, columns, projects and teams", async () => {
    const names = (await writeOperations()).map((item) => item.operation);

    for (const expected of [
      "POST /api/v1/projects/{projectId}/tasks",
      "PATCH /api/v1/tasks/{taskId}",
      "POST /api/v1/tasks/{taskId}/move",
      "DELETE /api/v1/tasks/{taskId}",
      "POST /api/v1/tasks/{taskId}/restore",
      "POST /api/v1/tasks/{taskId}/comments",
      "POST /api/v1/projects/{projectId}/epics",
      "PATCH /api/v1/epics/{epicId}",
      "POST /api/v1/projects/{projectId}/columns",
      "PATCH /api/v1/columns/{columnId}",
      "POST /api/v1/projects",
      "POST /api/v1/teams",
    ]) {
      expect(names).toContain(expected);
    }
  });
});
