// A Viewer gets 403 from every write endpoint of WT-03 (its exit criterion 5, checked in
// WS-039 section 6). Each handler is called for real, with a Viewer's session.
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { EndpointContract } from "@/lib/openapi/contract";
import { contracts } from "@/lib/openapi/contracts";
import { problemSchema } from "@/lib/schemas/problem";
import { apiRequest, createTestAccount, signInCookie } from "@/server/auth/testing";

const API_ROOT = path.join(process.cwd(), "src/app/api");

/** The resources of WT-03: projects, columns, tasks, comments, epics and teams. */
const TRACK_PREFIXES = [
  "/api/v1/projects",
  "/api/v1/columns",
  "/api/v1/tasks",
  "/api/v1/epics",
  "/api/v1/teams",
  // WS-140: sprints, and the sprints setting through PATCH /projects/{projectId}.
  "/api/v1/sprints",
];

const ANY_ID = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

const handlerSchema = z.custom<
  (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>
>((value) => typeof value === "function");

function writes(): EndpointContract[] {
  return contracts.filter(
    (contract) =>
      contract.method !== "get" &&
      contract.access.kind === "permission" &&
      TRACK_PREFIXES.some((prefix) => contract.path.startsWith(prefix)),
  );
}

/** "v1/tasks/[taskId]/move/route.ts" for "/api/v1/tasks/{taskId}/move". */
function routeFileOf(contract: EndpointContract): string {
  return `${contract.path.replace(/^\/api\//, "").replace(/\{([^}]+)\}/g, "[$1]")}/route.ts`;
}

function paramsOf(contract: EndpointContract): Record<string, string> {
  return Object.fromEntries(
    [...contract.path.matchAll(/\{([^}]+)\}/g)].map((match) => [match[1] ?? "", ANY_ID]),
  );
}

describe("a Viewer and the write endpoints of WT-03", () => {
  it("lists the track's write endpoints", () => {
    expect(writes().map((contract) => `${contract.method.toUpperCase()} ${contract.path}`)).toEqual(
      expect.arrayContaining([
        "POST /api/v1/projects",
        "PATCH /api/v1/tasks/{taskId}",
        "POST /api/v1/tasks/{taskId}/move",
        "DELETE /api/v1/tasks/{taskId}",
        "POST /api/v1/tasks/{taskId}/comments",
        "PATCH /api/v1/epics/{epicId}",
        "POST /api/v1/teams",
        "POST /api/v1/projects/{projectId}/sprints",
        "PATCH /api/v1/sprints/{sprintId}",
        "DELETE /api/v1/sprints/{sprintId}",
        "POST /api/v1/sprints/{sprintId}/start",
        "POST /api/v1/sprints/{sprintId}/complete",
      ]),
    );
  });

  it("gets 403 forbidden from every one of them", async () => {
    await createTestAccount({ email: "viewer@example.com", role: "viewer" });
    const cookie = await signInCookie("viewer@example.com");
    const answers: string[] = [];
    for (const contract of writes()) {
      const method = contract.method.toUpperCase();
      const exports = z
        .record(z.string(), z.unknown())
        .parse(await import(path.join(API_ROOT, routeFileOf(contract))));
      const handler = handlerSchema.parse(exports[method]);
      const url = contract.path.replace(/\{[^}]+\}/g, ANY_ID);
      const response = await handler(
        apiRequest(method as "POST" | "PATCH" | "DELETE", url, { cookie, body: {} }),
        { params: Promise.resolve(paramsOf(contract)) },
      );
      const body: unknown = await response.json().catch(() => null);
      const code = problemSchema.safeParse(body).data?.code ?? "none";
      answers.push(`${method} ${contract.path}: ${String(response.status)} ${code}`);
    }

    expect(answers).toEqual(
      writes().map(
        (contract) => `${contract.method.toUpperCase()} ${contract.path}: 403 forbidden`,
      ),
    );
  });
});
