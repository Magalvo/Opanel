import { describe, expect, it } from "vitest";
import { z } from "zod";

import { problemSchema } from "@/lib/schemas/problem";
import { taskPageSchema, taskSchema } from "@/lib/schemas/tasks";
import { apiRequest, createTestAccount, signInCookie } from "@/server/auth/testing";

import { GET as list, POST as create } from "../../projects/[projectId]/tasks/route";
import { POST as projectsPost } from "../../projects/route";
import { GET, PATCH } from "./route";

function project(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

function task(taskId: string) {
  return { params: Promise.resolve({ taskId }) };
}

async function cookieFor(role: "viewer" | "member" | "manager" | "admin") {
  await createTestAccount({ name: role, email: `${role}@example.com`, role });
  return signInCookie(`${role}@example.com`);
}

const conflictSchema = problemSchema.extend({
  code: z.literal("version_conflict"),
  current: taskSchema,
});

describe("task endpoints", () => {
  it("create, list, read by key, update and conflict", async () => {
    const manager = await cookieFor("manager");
    await projectsPost(
      apiRequest("POST", "/api/v1/projects", { cookie: manager, body: { key: "OPA", name: "O" } }),
      undefined,
    );
    const cookie = await cookieFor("member");

    const created = await create(
      apiRequest("POST", "/api/v1/projects/OPA/tasks", { cookie, body: { title: "Fix login" } }),
      project("OPA"),
    );
    expect(created.status).toBe(201);
    expect(taskSchema.parse(await created.json()).key).toBe("OPA-1");

    const page = await list(
      apiRequest("GET", "/api/v1/projects/OPA/tasks", { cookie }),
      project("OPA"),
    );
    expect(taskPageSchema.parse(await page.json()).items.map((item) => item.key)).toEqual([
      "OPA-1",
    ]);

    const read = await GET(apiRequest("GET", "/api/v1/tasks/OPA-1", { cookie }), task("OPA-1"));
    expect(taskSchema.parse(await read.json()).title).toBe("Fix login");

    const updated = await PATCH(
      apiRequest("PATCH", "/api/v1/tasks/OPA-1", {
        cookie,
        body: { title: "Fix sign-in", version: 1 },
      }),
      task("OPA-1"),
    );
    expect(updated.status).toBe(200);

    const stale = await PATCH(
      apiRequest("PATCH", "/api/v1/tasks/OPA-1", { cookie, body: { title: "X", version: 1 } }),
      task("OPA-1"),
    );
    expect(stale.status).toBe(409);
    expect(conflictSchema.parse(await stale.json()).current.title).toBe("Fix sign-in");

    const missing = await GET(apiRequest("GET", "/api/v1/tasks/OPA-2", { cookie }), task("OPA-2"));
    expect(missing.status).toBe(404);
  });

  it("lets a Viewer read but not write, and answers 401 without a session", async () => {
    const manager = await cookieFor("manager");
    await projectsPost(
      apiRequest("POST", "/api/v1/projects", { cookie: manager, body: { key: "OPA", name: "O" } }),
      undefined,
    );
    await create(
      apiRequest("POST", "/api/v1/projects/OPA/tasks", { cookie: manager, body: { title: "T" } }),
      project("OPA"),
    );
    const viewer = await cookieFor("viewer");

    const statuses = async (cookie?: string) => {
      const options = cookie === undefined ? {} : { cookie };
      const responses = await Promise.all([
        create(
          apiRequest("POST", "/api/v1/projects/OPA/tasks", { ...options, body: { title: "X" } }),
          project("OPA"),
        ),
        PATCH(
          apiRequest("PATCH", "/api/v1/tasks/OPA-1", {
            ...options,
            body: { title: "X", version: 1 },
          }),
          task("OPA-1"),
        ),
        list(apiRequest("GET", "/api/v1/projects/OPA/tasks", options), project("OPA")),
        GET(apiRequest("GET", "/api/v1/tasks/OPA-1", options), task("OPA-1")),
      ]);
      return responses.map((response) => response.status);
    };

    expect(await statuses(viewer)).toEqual([403, 403, 200, 200]);
    expect(await statuses()).toEqual([401, 401, 401, 401]);
  });
});
