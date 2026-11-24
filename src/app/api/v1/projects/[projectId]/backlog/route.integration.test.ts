import { describe, expect, it } from "vitest";

import { taskPageSchema, taskSchema } from "@/lib/schemas/tasks";
import {
  apiRequest,
  bearerRequest,
  createTestAccount,
  createTestAgent,
  createTestToken,
  signInCookie,
} from "@/server/auth/testing";

import { POST as move } from "../../../tasks/[taskId]/move/route";
import { POST as createProject } from "../../route";
import { POST as createTask } from "../tasks/route";
import { GET as backlog } from "./route";

const project = { params: Promise.resolve({ projectId: "OPA" }) };

function task(taskId: string) {
  return { params: Promise.resolve({ taskId }) };
}

async function setup() {
  await createTestAccount({ email: "manager@example.com", role: "manager" });
  await createTestAccount({ email: "viewer@example.com", role: "viewer" });
  const cookie = await signInCookie("manager@example.com");
  await createProject(
    apiRequest("POST", "/api/v1/projects", { cookie, body: { key: "OPA", name: "O" } }),
    undefined,
  );
  const agent = await createTestAgent({
    name: "Worker",
    role: "worker_agent",
    scopes: ["projects:read", "tasks:read", "tasks:write"],
  });
  const { token } = await createTestToken(agent.id);
  return { cookie, token };
}

describe("GET /api/v1/projects/{projectId}/backlog (WS-101)", () => {
  it("lists the backlog for a person and an agent, and answers 400 and 401", async () => {
    const { cookie, token } = await setup();
    const created = await createTask(
      apiRequest("POST", "/api/v1/projects/OPA/tasks", {
        cookie,
        body: { title: "Later", columnId: null },
      }),
      project,
    );
    expect(created.status).toBe(201);
    expect(taskSchema.parse(await created.json()).columnId).toBeNull();

    const byPerson = await backlog(
      apiRequest("GET", "/api/v1/projects/OPA/backlog", { cookie }),
      project,
    );
    expect(byPerson.status).toBe(200);
    expect(taskPageSchema.parse(await byPerson.json()).items.map((t) => t.key)).toEqual(["OPA-1"]);

    const byAgent = await backlog(bearerRequest("/api/v1/projects/OPA/backlog", token), project);
    expect(byAgent.status).toBe(200);
    expect(taskPageSchema.parse(await byAgent.json()).items).toHaveLength(1);

    const bad = await backlog(
      apiRequest("GET", "/api/v1/projects/OPA/backlog?cursor=x!", { cookie }),
      project,
    );
    expect(bad.status).toBe(400);
    const anonymous = await backlog(apiRequest("GET", "/api/v1/projects/OPA/backlog"), project);
    expect(anonymous.status).toBe(401);
  });

  it("lets an agent with tasks:write move a task to the backlog, and refuses a Viewer", async () => {
    const { cookie, token } = await setup();
    await createTask(
      apiRequest("POST", "/api/v1/projects/OPA/tasks", { cookie, body: { title: "A" } }),
      project,
    );

    const moved = await move(
      bearerRequest("/api/v1/tasks/OPA-1/move", token, {
        method: "POST",
        body: JSON.stringify({ columnId: null, version: 1 }),
      }),
      task("OPA-1"),
    );
    expect(moved.status).toBe(200);
    expect(taskSchema.parse(await moved.json())).toMatchObject({ columnId: null, version: 2 });

    const viewer = await signInCookie("viewer@example.com");
    const refused = await move(
      apiRequest("POST", "/api/v1/tasks/OPA-1/move", {
        cookie: viewer,
        body: { columnId: null, version: 2 },
      }),
      task("OPA-1"),
    );
    expect(refused.status).toBe(403);
  });
});

describe("GET /api/v1/projects/{projectId}/backlog with filters (WS-116 test 10)", () => {
  it("applies repeated filters and q, and answers 400 on the field", async () => {
    const { cookie } = await setup();
    for (const [title, priority] of [
      ["Logout button", "high"],
      ["Notes", "low"],
      ["Later", "none"],
    ] as const) {
      await createTask(
        apiRequest("POST", "/api/v1/projects/OPA/tasks", {
          cookie,
          body: { title, priority, columnId: null },
        }),
        project,
      );
    }
    const keys = async (query: string) => {
      const response = await backlog(
        apiRequest("GET", `/api/v1/projects/OPA/backlog?${query}`, { cookie }),
        project,
      );
      expect(response.status, query).toBe(200);
      return taskPageSchema.parse(await response.json()).items.map((t) => t.key);
    };

    expect(await keys("priority=high&priority=low")).toEqual(["OPA-1", "OPA-2"]);
    expect(await keys("q=logo")).toEqual(["OPA-1"]);
    const bad = await backlog(
      apiRequest("GET", "/api/v1/projects/OPA/backlog?priority=huge", { cookie }),
      project,
    );
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { errors: { path: string }[] }).errors[0]?.path).toBe("priority");
  });
});
