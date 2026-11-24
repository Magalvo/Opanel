import { describe, expect, it } from "vitest";

import { problemSchema } from "@/lib/schemas/problem";
import { taskPageSchema } from "@/lib/schemas/tasks";
import { apiRequest, createTestAccount, signInCookie } from "@/server/auth/testing";

import { POST as createProject } from "../../route";
import { GET, POST } from "./route";

// The board list with filters (WS-116 test 10).

const project = { params: Promise.resolve({ projectId: "OPA" }) };

async function setup() {
  await createTestAccount({ email: "manager@example.com", role: "manager" });
  const cookie = await signInCookie("manager@example.com");
  await createProject(
    apiRequest("POST", "/api/v1/projects", { cookie, body: { key: "OPA", name: "O" } }),
    undefined,
  );
  for (const [title, priority, type] of [
    ["Login fails", "urgent", "bug"],
    ["Release notes", "none", "story"],
    ["Tidy up", "low", "task"],
  ] as const) {
    await POST(
      apiRequest("POST", "/api/v1/projects/OPA/tasks", {
        cookie,
        body: { title, priority, type },
      }),
      project,
    );
  }
  return { cookie };
}

describe("GET /api/v1/projects/{projectId}/tasks with filters (WS-116)", () => {
  it("reaches the service with repeated parameters", async () => {
    const { cookie } = await setup();
    const keys = async (query: string) => {
      const response = await GET(
        apiRequest("GET", `/api/v1/projects/OPA/tasks?${query}`, { cookie }),
        project,
      );
      expect(response.status, query).toBe(200);
      return taskPageSchema.parse(await response.json()).items.map((t) => t.key);
    };

    expect(await keys("priority=urgent&priority=none")).toEqual(["OPA-1", "OPA-2"]);
    expect(await keys("type=story&type=task&priority=low")).toEqual(["OPA-3"]);
    expect(await keys("q=login")).toEqual(["OPA-1"]);
  });

  it("answers 400 naming the field", async () => {
    const { cookie } = await setup();

    for (const [query, field] of [
      ["type=epic", "type"],
      ["dueFrom=2030-02-01&dueTo=2030-01-01", "dueTo"],
      ["q=--", "q"],
      ["assigneeTeamId=me", "assigneeTeamId"],
    ] as const) {
      const response = await GET(
        apiRequest("GET", `/api/v1/projects/OPA/tasks?${query}`, { cookie }),
        project,
      );
      expect(response.status, query).toBe(400);
      expect(problemSchema.parse(await response.json()).errors?.[0]?.path, query).toBe(field);
    }
  });
});
