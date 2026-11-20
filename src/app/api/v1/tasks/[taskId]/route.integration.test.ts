import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AGENT_SCOPES } from "@/lib/schemas/permissions";
import { problemSchema } from "@/lib/schemas/problem";
import { taskPageSchema, taskSchema } from "@/lib/schemas/tasks";
import { agentActor } from "@/server/auth/actor";
import {
  apiRequest,
  bearerRequest,
  createTestAccount,
  createTestAgent,
  createTestToken,
  signInCookie,
} from "@/server/auth/testing";
import { createTask } from "@/server/services/tasks";

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
  it("returns the reporter's kind: agent for an agent's task (WS-074)", async () => {
    const manager = await cookieFor("manager");
    await projectsPost(
      apiRequest("POST", "/api/v1/projects", { cookie: manager, body: { key: "OPA", name: "O" } }),
      undefined,
    );
    const agent = await createTestAgent({
      name: "QA Bot",
      role: "worker_agent",
      scopes: [...AGENT_SCOPES],
    });
    await createTask(
      agentActor({
        accountId: agent.id,
        role: "worker_agent",
        scopes: AGENT_SCOPES,
        projectIds: null,
      }),
      "OPA",
      { title: "Found by the bot" },
    );

    const read = await GET(
      apiRequest("GET", "/api/v1/tasks/OPA-1", { cookie: manager }),
      task("OPA-1"),
    );

    expect(read.status).toBe(200);
    expect(taskSchema.parse(await read.json()).reporter).toEqual({
      id: agent.id,
      name: "QA Bot",
      kind: "agent",
    });
  });

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

  it("sets a bug's severity with a cookie and with an agent token; a Viewer gets 403 (WS-088)", async () => {
    const manager = await cookieFor("manager");
    await projectsPost(
      apiRequest("POST", "/api/v1/projects", { cookie: manager, body: { key: "OPA", name: "O" } }),
      undefined,
    );
    const cookie = await cookieFor("member");
    const created = await create(
      apiRequest("POST", "/api/v1/projects/OPA/tasks", {
        cookie,
        body: { title: "Crash", type: "bug", severity: "medium" },
      }),
      project("OPA"),
    );
    expect(taskSchema.parse(await created.json()).severity).toBe("medium");

    const byMember = await PATCH(
      apiRequest("PATCH", "/api/v1/tasks/OPA-1", {
        cookie,
        body: { severity: "high", version: 1 },
      }),
      task("OPA-1"),
    );
    expect(byMember.status).toBe(200);
    expect(taskSchema.parse(await byMember.json()).severity).toBe("high");

    const agent = await createTestAgent({
      name: "Worker",
      role: "worker_agent",
      scopes: [...AGENT_SCOPES],
    });
    const { token } = await createTestToken(agent.id);
    const byAgent = await PATCH(
      bearerRequest("/api/v1/tasks/OPA-1", token, {
        method: "PATCH",
        body: JSON.stringify({ severity: null, version: 2 }),
      }),
      task("OPA-1"),
    );
    expect(byAgent.status).toBe(200);
    expect(taskSchema.parse(await byAgent.json()).severity).toBeNull();

    const viewer = await cookieFor("viewer");
    const byViewer = await PATCH(
      apiRequest("PATCH", "/api/v1/tasks/OPA-1", {
        cookie: viewer,
        body: { severity: "low", version: 3 },
      }),
      task("OPA-1"),
    );
    expect(byViewer.status).toBe(403);
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
