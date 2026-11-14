import { describe, expect, it } from "vitest";

import { taskSchema } from "@/lib/schemas/tasks";
import { apiRequest, createTestAccount, signInCookie } from "@/server/auth/testing";

import { POST as createTask } from "../../../projects/[projectId]/tasks/route";
import { POST as createProject } from "../../../projects/route";
import { DELETE } from "../route";
import { POST as restore } from "./route";

const project = { params: Promise.resolve({ projectId: "OPA" }) };

function task(taskId: string) {
  return { params: Promise.resolve({ taskId }) };
}

async function cookieFor(role: "viewer" | "member" | "manager") {
  await createTestAccount({ name: role, email: `${role}@example.com`, role });
  return signInCookie(`${role}@example.com`);
}

describe("DELETE /api/v1/tasks/{taskId} and POST …/restore", () => {
  it("deletes and restores, with the documented refusals", async () => {
    const manager = await cookieFor("manager");
    const member = await cookieFor("member");
    const viewer = await cookieFor("viewer");
    await createProject(
      apiRequest("POST", "/api/v1/projects", { cookie: manager, body: { key: "OPA", name: "O" } }),
      undefined,
    );
    await createTask(
      apiRequest("POST", "/api/v1/projects/OPA/tasks", { cookie: manager, body: { title: "A" } }),
      project,
    );
    await createTask(
      apiRequest("POST", "/api/v1/projects/OPA/tasks", { cookie: member, body: { title: "B" } }),
      project,
    );

    const notOwn = await DELETE(
      apiRequest("DELETE", "/api/v1/tasks/OPA-1", { cookie: member }),
      task("OPA-1"),
    );
    const byViewer = await DELETE(
      apiRequest("DELETE", "/api/v1/tasks/OPA-2", { cookie: viewer }),
      task("OPA-2"),
    );
    const own = await DELETE(
      apiRequest("DELETE", "/api/v1/tasks/OPA-2", { cookie: member }),
      task("OPA-2"),
    );
    const again = await DELETE(
      apiRequest("DELETE", "/api/v1/tasks/OPA-2", { cookie: member }),
      task("OPA-2"),
    );
    const anonymous = await DELETE(apiRequest("DELETE", "/api/v1/tasks/OPA-1"), task("OPA-1"));
    expect([notOwn.status, byViewer.status, own.status, again.status, anonymous.status]).toEqual([
      403, 403, 204, 404, 401,
    ]);

    const memberRestore = await restore(
      apiRequest("POST", "/api/v1/tasks/OPA-2/restore", { cookie: member }),
      task("OPA-2"),
    );
    expect(memberRestore.status).toBe(403);
    const restored = await restore(
      apiRequest("POST", "/api/v1/tasks/OPA-2/restore", { cookie: manager }),
      task("OPA-2"),
    );
    expect(restored.status).toBe(200);
    expect(taskSchema.parse(await restored.json())).toMatchObject({
      key: "OPA-2",
      deletedAt: null,
    });
  });
});
