import { describe, expect, it } from "vitest";

import { activityPageSchema } from "@/lib/schemas/activity";
import { problemSchema } from "@/lib/schemas/problem";
import {
  apiRequest,
  bearerRequest,
  createTestAccount,
  createTestAgent,
  createTestToken,
  signInCookie,
} from "@/server/auth/testing";

import { POST as createTask } from "../../../projects/[projectId]/tasks/route";
import { POST as createProject } from "../../../projects/route";
import { POST as comment } from "../comments/route";
import { GET } from "./route";

// The activity endpoint (WS-117 test 9).

function task(taskId: string) {
  return { params: Promise.resolve({ taskId }) };
}

async function setup() {
  await createTestAccount({ name: "Manager", email: "manager@example.com", role: "manager" });
  await createTestAccount({ name: "Viewer", email: "viewer@example.com", role: "viewer" });
  const manager = await signInCookie("manager@example.com");
  const viewer = await signInCookie("viewer@example.com");
  await createProject(
    apiRequest("POST", "/api/v1/projects", { cookie: manager, body: { key: "OPA", name: "O" } }),
    undefined,
  );
  const created = await createTask(
    apiRequest("POST", "/api/v1/projects/OPA/tasks", { cookie: manager, body: { title: "A" } }),
    { params: Promise.resolve({ projectId: "OPA" }) },
  );
  const { id } = (await created.json()) as { id: string };
  await comment(
    apiRequest("POST", "/api/v1/tasks/OPA-1/comments", {
      cookie: manager,
      body: { body: "Seen" },
    }),
    task("OPA-1"),
  );
  return { viewer, id };
}

describe("GET /api/v1/tasks/{taskId}/activity (WS-117)", () => {
  it("answers the page by key for a Viewer and by id for an agent's token", async () => {
    const { viewer, id } = await setup();
    const agent = await createTestAgent({
      name: "Reader",
      scopes: ["projects:read", "tasks:read"],
    });
    const { token } = await createTestToken(agent.id);

    const byKey = await GET(
      apiRequest("GET", "/api/v1/tasks/OPA-1/activity", { cookie: viewer }),
      task("OPA-1"),
    );
    const byId = await GET(bearerRequest(`/api/v1/tasks/${id}/activity`, token), task(id));

    expect(byKey.status).toBe(200);
    expect(byId.status).toBe(200);
    const page = activityPageSchema.parse(await byKey.json());
    expect(page.items.map((item) => item.kind)).toEqual(["event", "comment"]);
    expect(activityPageSchema.parse(await byId.json())).toEqual(page);
  });

  it("answers 400 to a cursor it did not make, and 401 without a session", async () => {
    const { viewer } = await setup();

    const bad = await GET(
      apiRequest("GET", "/api/v1/tasks/OPA-1/activity?cursor=nope", { cookie: viewer }),
      task("OPA-1"),
    );
    const anonymous = await GET(apiRequest("GET", "/api/v1/tasks/OPA-1/activity"), task("OPA-1"));

    expect(bad.status).toBe(400);
    expect(problemSchema.parse(await bad.json()).errors).toEqual([
      { path: "cursor", message: "Invalid cursor." },
    ]);
    expect(anonymous.status).toBe(401);
  });
});
