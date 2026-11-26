import { describe, expect, it } from "vitest";

import { problemSchema } from "@/lib/schemas/problem";
import { taskSchema } from "@/lib/schemas/tasks";
import { apiRequest, createTestAccount, signInCookie } from "@/server/auth/testing";

import { POST as createTask } from "../../../projects/[projectId]/tasks/route";
import { POST as createProject } from "../../../projects/route";
import { DELETE, POST } from "./route";

// The link endpoints through /api/v1 (WS-134 test 15).

function task(taskId: string) {
  return { params: Promise.resolve({ taskId }) };
}

async function setup() {
  await createTestAccount({ name: "Manager", email: "manager@example.com", role: "manager" });
  const cookie = await signInCookie("manager@example.com");
  for (const key of ["OPA", "API"]) {
    await createProject(
      apiRequest("POST", "/api/v1/projects", { cookie, body: { key, name: key } }),
      undefined,
    );
    await createTask(
      apiRequest("POST", `/api/v1/projects/${key}/tasks`, { cookie, body: { title: key } }),
      { params: Promise.resolve({ projectId: key }) },
    );
  }
  return cookie;
}

const path = "/api/v1/tasks/OPA-1/links";
const query = "type=blocks&direction=outgoing&taskId=API-1";

describe("task link endpoints (WS-134)", () => {
  it("adds a link with 200 and the task, and removes it with 204", async () => {
    const cookie = await setup();
    const body = { type: "blocks", direction: "outgoing", taskId: "API-1" };

    const added = await POST(apiRequest("POST", path, { cookie, body }), task("OPA-1"));
    expect(added.status).toBe(200);
    const answer = taskSchema.parse(await added.json());
    expect(answer.links).toEqual([
      expect.objectContaining({ type: "blocks", direction: "outgoing" }),
    ]);

    const removed = await DELETE(
      apiRequest("DELETE", `${path}?${query}`, { cookie }),
      task("OPA-1"),
    );
    expect(removed.status).toBe(204);
    const again = await DELETE(apiRequest("DELETE", `${path}?${query}`, { cookie }), task("OPA-1"));
    expect(again.status).toBe(404);
  });

  it("answers 400 for a malformed body or query, and 401 without credentials", async () => {
    const cookie = await setup();

    const body = await POST(
      apiRequest("POST", path, { cookie, body: { type: "parent_of", direction: "outgoing" } }),
      task("OPA-1"),
    );
    expect(body.status).toBe(400);
    expect(problemSchema.parse(await body.json()).code).toBe("invalid_request");
    const missing = await DELETE(
      apiRequest("DELETE", `${path}?type=blocks`, { cookie }),
      task("OPA-1"),
    );
    expect(missing.status).toBe(400);

    const anonymous = await POST(
      apiRequest("POST", path, {
        body: { type: "blocks", direction: "outgoing", taskId: "API-1" },
      }),
      task("OPA-1"),
    );
    expect(anonymous.status).toBe(401);
    const anonymousDelete = await DELETE(apiRequest("DELETE", `${path}?${query}`), task("OPA-1"));
    expect(anonymousDelete.status).toBe(401);
  });
});
