import { describe, expect, it } from "vitest";

import { problemSchema } from "@/lib/schemas/problem";
import { taskListItemPageSchema } from "@/lib/schemas/tasks";
import {
  apiRequest,
  bearerRequest,
  createTestAccount,
  createTestAgent,
  createTestToken,
  signInCookie,
} from "@/server/auth/testing";
import { encodeTaskListCursor } from "@/server/http/pagination";

import { POST as createTask } from "../projects/[projectId]/tasks/route";
import { POST as createProject } from "../projects/route";
import { GET } from "./route";

// The list of tasks across projects (WS-118 test 10).

async function setup() {
  await createTestAccount({ email: "manager@example.com", role: "manager" });
  const cookie = await signInCookie("manager@example.com");
  for (const key of ["OPA", "WEB"]) {
    await createProject(
      apiRequest("POST", "/api/v1/projects", { cookie, body: { key, name: key } }),
      undefined,
    );
    for (const [title, priority] of [
      ["Login", "urgent"],
      ["Notes", "none"],
    ] as const) {
      await createTask(
        apiRequest("POST", `/api/v1/projects/${key}/tasks`, {
          cookie,
          body: { title, priority },
        }),
        { params: Promise.resolve({ projectId: key }) },
      );
    }
  }
  return { cookie };
}

describe("GET /api/v1/tasks (WS-118)", () => {
  it("lists across projects with repeated parameters, for a person and a token", async () => {
    const { cookie } = await setup();
    const agent = await createTestAgent({
      name: "Reader",
      scopes: ["projects:read", "tasks:read"],
    });
    const { token } = await createTestToken(agent.id);

    const byPerson = await GET(
      apiRequest("GET", "/api/v1/tasks?sort=-key&priority=urgent&projectId=OPA&projectId=WEB", {
        cookie,
      }),
      undefined,
    );
    const byToken = await GET(bearerRequest("/api/v1/tasks?sort=key&q=notes", token), undefined);

    expect(byPerson.status).toBe(200);
    expect(taskListItemPageSchema.parse(await byPerson.json()).items.map((t) => t.key)).toEqual([
      "WEB-1",
      "OPA-1",
    ]);
    expect(byToken.status).toBe(200);
    expect(taskListItemPageSchema.parse(await byToken.json()).items.map((t) => t.key)).toEqual([
      "OPA-2",
      "WEB-2",
    ]);
  });

  it("answers 400 naming the field, 404 for an unknown project and 401 without a session", async () => {
    const { cookie } = await setup();

    const badSort = await GET(
      apiRequest("GET", "/api/v1/tasks?sort=status", { cookie }),
      undefined,
    );
    const unknown = await GET(
      apiRequest("GET", "/api/v1/tasks?projectId=ZZZ", { cookie }),
      undefined,
    );
    const anonymous = await GET(apiRequest("GET", "/api/v1/tasks"), undefined);

    expect(badSort.status).toBe(400);
    expect(problemSchema.parse(await badSort.json()).errors?.[0]?.path).toBe("sort");
    expect(unknown.status).toBe(404);
    expect(anonymous.status).toBe(401);
  });

  it("answers 400, not 500, for a cursor whose date is no real instant (WS-121 test 4)", async () => {
    const { cookie } = await setup();
    const cursor = encodeTaskListCursor({
      sort: "-updated",
      values: ["2026-02-30T12:00:00.000000Z"],
      id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    });

    const response = await GET(
      apiRequest("GET", `/api/v1/tasks?sort=-updated&cursor=${cursor}`, { cookie }),
      undefined,
    );

    expect(response.status).toBe(400);
    expect(problemSchema.parse(await response.json()).errors).toEqual([
      { path: "cursor", message: "Invalid cursor." },
    ]);
  });
});
