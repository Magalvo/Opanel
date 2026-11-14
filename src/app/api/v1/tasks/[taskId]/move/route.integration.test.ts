import { describe, expect, it } from "vitest";

import { columnListSchema } from "@/lib/schemas/columns";
import { taskSchema } from "@/lib/schemas/tasks";
import { apiRequest, createTestAccount, signInCookie } from "@/server/auth/testing";

import { GET as columnsOf } from "../../../projects/[projectId]/columns/route";
import { POST as createTask } from "../../../projects/[projectId]/tasks/route";
import { POST as createProject } from "../../../projects/route";
import { POST as move } from "./route";

const project = { params: Promise.resolve({ projectId: "OPA" }) };

function task(taskId: string) {
  return { params: Promise.resolve({ taskId }) };
}

describe("POST /api/v1/tasks/{taskId}/move", () => {
  it("moves a task, and answers 400, 404, 409 and 401 as documented", async () => {
    await createTestAccount({ email: "manager@example.com", role: "manager" });
    const cookie = await signInCookie("manager@example.com");
    await createProject(
      apiRequest("POST", "/api/v1/projects", { cookie, body: { key: "OPA", name: "O" } }),
      undefined,
    );
    await createTask(
      apiRequest("POST", "/api/v1/projects/OPA/tasks", { cookie, body: { title: "A" } }),
      project,
    );
    const columns = columnListSchema.parse(
      await (
        await columnsOf(apiRequest("GET", "/api/v1/projects/OPA/columns", { cookie }), project)
      ).json(),
    ).items;
    const done = columns[2]?.id ?? "";

    const moved = await move(
      apiRequest("POST", "/api/v1/tasks/OPA-1/move", {
        cookie,
        body: { columnId: done, version: 1 },
      }),
      task("OPA-1"),
    );
    expect(moved.status).toBe(200);
    expect(taskSchema.parse(await moved.json())).toMatchObject({ columnId: done, version: 2 });

    const both = await move(
      apiRequest("POST", "/api/v1/tasks/OPA-1/move", {
        cookie,
        body: { columnId: done, afterTaskId: done, beforeTaskId: done, version: 2 },
      }),
      task("OPA-1"),
    );
    const missing = await move(
      apiRequest("POST", "/api/v1/tasks/OPA-9/move", {
        cookie,
        body: { columnId: done, version: 1 },
      }),
      task("OPA-9"),
    );
    const stale = await move(
      apiRequest("POST", "/api/v1/tasks/OPA-1/move", {
        cookie,
        body: { columnId: done, version: 1 },
      }),
      task("OPA-1"),
    );
    const anonymous = await move(
      apiRequest("POST", "/api/v1/tasks/OPA-1/move", { body: { columnId: done, version: 2 } }),
      task("OPA-1"),
    );

    expect([both.status, missing.status, stale.status, anonymous.status]).toEqual([
      400, 404, 409, 401,
    ]);
    expect(await stale.json()).toMatchObject({
      code: "version_conflict",
      current: { columnId: done },
    });
  });
});
