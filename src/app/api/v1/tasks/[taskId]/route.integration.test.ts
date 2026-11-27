import { sql } from "drizzle-orm";
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
  testActor,
} from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { updateProject } from "@/server/services/projects";
import { createSprint } from "@/server/services/sprints";
import { createTask } from "@/server/services/tasks";

import { GET as list, POST as create } from "../../projects/[projectId]/tasks/route";
import { POST as projectsPost } from "../../projects/route";
import { POST as move } from "./move/route";
import { DELETE, GET, PATCH } from "./route";

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

  it("sets priority and due date with a cookie and with an agent token; a Viewer gets 403 (WS-102)", async () => {
    const manager = await cookieFor("manager");
    await projectsPost(
      apiRequest("POST", "/api/v1/projects", { cookie: manager, body: { key: "OPA", name: "O" } }),
      undefined,
    );
    const cookie = await cookieFor("member");
    const created = await create(
      apiRequest("POST", "/api/v1/projects/OPA/tasks", {
        cookie,
        body: { title: "Ship", priority: "low", dueDate: "2026-12-01" },
      }),
      project("OPA"),
    );
    expect(taskSchema.parse(await created.json())).toMatchObject({
      priority: "low",
      dueDate: "2026-12-01",
    });

    const byMember = await PATCH(
      apiRequest("PATCH", "/api/v1/tasks/OPA-1", {
        cookie,
        body: { priority: "high", version: 1 },
      }),
      task("OPA-1"),
    );
    expect(byMember.status).toBe(200);
    expect(taskSchema.parse(await byMember.json()).priority).toBe("high");

    const agent = await createTestAgent({
      name: "Worker",
      role: "worker_agent",
      scopes: [...AGENT_SCOPES],
    });
    const { token } = await createTestToken(agent.id);
    const byAgent = await PATCH(
      bearerRequest("/api/v1/tasks/OPA-1", token, {
        method: "PATCH",
        body: JSON.stringify({ priority: "urgent", dueDate: null, version: 2 }),
      }),
      task("OPA-1"),
    );
    expect(byAgent.status).toBe(200);
    expect(taskSchema.parse(await byAgent.json())).toMatchObject({
      priority: "urgent",
      dueDate: null,
    });

    const badDate = await PATCH(
      apiRequest("PATCH", "/api/v1/tasks/OPA-1", {
        cookie,
        body: { dueDate: "0000-01-01", version: 3 },
      }),
      task("OPA-1"),
    );
    expect(badDate.status).toBe(400);
    expect(JSON.stringify(await badDate.json())).toContain("dueDate");

    const viewer = await cookieFor("viewer");
    const byViewer = await PATCH(
      apiRequest("PATCH", "/api/v1/tasks/OPA-1", {
        cookie: viewer,
        body: { priority: "low", version: 3 },
      }),
      task("OPA-1"),
    );
    expect(byViewer.status).toBe(403);
  });

  it("takes storyPoints on create and edit, clears it with null, and names it in a 400 (WS-139 test 8)", async () => {
    const manager = await cookieFor("manager");
    await projectsPost(
      apiRequest("POST", "/api/v1/projects", { cookie: manager, body: { key: "OPA", name: "O" } }),
      undefined,
    );
    const cookie = await cookieFor("member");
    const created = await create(
      apiRequest("POST", "/api/v1/projects/OPA/tasks", {
        cookie,
        body: { title: "Ship", storyPoints: 2.5 },
      }),
      project("OPA"),
    );
    expect(created.status).toBe(201);
    expect(taskSchema.parse(await created.json()).storyPoints).toBe(2.5);

    const edited = await PATCH(
      apiRequest("PATCH", "/api/v1/tasks/OPA-1", { cookie, body: { storyPoints: 8, version: 1 } }),
      task("OPA-1"),
    );
    expect(edited.status).toBe(200);
    expect(taskSchema.parse(await edited.json()).storyPoints).toBe(8);

    const cleared = await PATCH(
      apiRequest("PATCH", "/api/v1/tasks/OPA-1", {
        cookie,
        body: { storyPoints: null, version: 2 },
      }),
      task("OPA-1"),
    );
    expect(taskSchema.parse(await cleared.json()).storyPoints).toBeNull();

    const listed = await list(apiRequest("GET", "/api/v1/projects/OPA/tasks", { cookie }), {
      params: Promise.resolve({ projectId: "OPA" }),
    });
    expect(taskPageSchema.parse(await listed.json()).items[0]?.storyPoints).toBeNull();

    const refused = await PATCH(
      apiRequest("PATCH", "/api/v1/tasks/OPA-1", {
        cookie,
        body: { storyPoints: 1.25, version: 3 },
      }),
      task("OPA-1"),
    );
    expect(refused.status).toBe(400);
    expect(problemSchema.parse(await refused.json()).errors?.map((field) => field.path)).toEqual([
      "storyPoints",
    ]);
  });

  it("takes parentId, names the field of a refusal, and answers the 409 codes (WS-133 test 14)", async () => {
    const manager = await cookieFor("manager");
    await projectsPost(
      apiRequest("POST", "/api/v1/projects", { cookie: manager, body: { key: "OPA", name: "O" } }),
      undefined,
    );
    const cookie = await cookieFor("member");
    for (const title of ["Parent", "Loose"]) {
      await create(
        apiRequest("POST", "/api/v1/projects/OPA/tasks", { cookie, body: { title } }),
        project("OPA"),
      );
    }

    const child = await create(
      apiRequest("POST", "/api/v1/projects/OPA/tasks", {
        cookie,
        body: { title: "Child", parentId: "OPA-1" },
      }),
      project("OPA"),
    );
    expect(child.status).toBe(201);
    expect(taskSchema.parse(await child.json()).parent?.key).toBe("OPA-1");

    const refused = await PATCH(
      apiRequest("PATCH", "/api/v1/tasks/OPA-2", {
        cookie,
        body: { parentId: "OPA-3", version: 1 },
      }),
      task("OPA-2"),
    );
    expect(refused.status).toBe(400);
    expect(problemSchema.parse(await refused.json()).errors?.map((field) => field.path)).toEqual([
      "parentId",
    ]);

    const parent = await GET(apiRequest("GET", "/api/v1/tasks/OPA-1", { cookie }), task("OPA-1"));
    const answer = taskSchema.parse(await parent.json());
    expect(answer.subtasks).toEqual({ done: 0, total: 1 });
    expect(answer.subtaskList.map((item) => item.key)).toEqual(["OPA-3"]);
    expect(answer.subtaskList[0]?.parent?.key).toBe("OPA-1");

    const blocked = await DELETE(
      apiRequest("DELETE", "/api/v1/tasks/OPA-1", { cookie: manager }),
      task("OPA-1"),
    );
    expect(blocked.status).toBe(409);
    expect(problemSchema.parse(await blocked.json()).code).toBe("has_subtasks");
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

  it("takes sprintId on create, edit and move, names it in a 400, and answers the 409 codes (WS-141 test 22)", async () => {
    const manager = await cookieFor("manager");
    await projectsPost(
      apiRequest("POST", "/api/v1/projects", { cookie: manager, body: { key: "OPA", name: "O" } }),
      undefined,
    );
    const owner = testActor(
      await createTestAccount({ email: "owner@example.com", role: "manager" }),
    );
    await updateProject(owner, "OPA", { sprintsEnabled: true, version: 1 });
    const dates = { startDate: "2026-12-01", endDate: "2026-12-14" };
    const active = await createSprint(owner, "OPA", { name: "Sprint 1", ...dates });
    const planned = await createSprint(owner, "OPA", { name: "Sprint 2", ...dates });
    const cookie = await cookieFor("member");
    const post = (body: unknown) =>
      create(apiRequest("POST", "/api/v1/projects/OPA/tasks", { cookie, body }), project("OPA"));
    const patch = (key: string, body: unknown) =>
      PATCH(apiRequest("PATCH", `/api/v1/tasks/${key}`, { cookie, body }), task(key));
    const moveTo = (key: string, body: unknown) =>
      move(apiRequest("POST", `/api/v1/tasks/${key}/move`, { cookie, body }), task(key));
    const code = async (response: Response) => {
      const problem = problemSchema.parse(await response.json());
      return [response.status, problem.code, problem.errors?.map((field) => field.path)];
    };

    const created = await post({ title: "Planned", sprintId: planned.id });
    expect(created.status).toBe(201);
    expect(taskSchema.parse(await created.json()).sprint).toEqual({
      id: planned.id,
      name: "Sprint 2",
      state: "planned",
    });
    // No active sprint yet: a column is refused.
    const firstColumn = (
      await getDb().execute<{ id: string }>(sql`select id from columns order by position limit 1`)
    )[0]?.id;
    expect(await code(await moveTo("OPA-1", { columnId: firstColumn, version: 1 }))).toEqual([
      409,
      "no_active_sprint",
      undefined,
    ]);
    expect(
      await code(await moveTo("OPA-1", { columnId: firstColumn, sprintId: null, version: 1 })),
    ).toEqual([400, "invalid_request", ["sprintId"]]);

    await getDb().execute(
      sql`update sprints set state = 'active', started_at = now() where id = ${active.id}`,
    );
    const edited = await patch("OPA-1", { sprintId: active.id, version: 1 });
    expect(edited.status).toBe(200);
    expect(taskSchema.parse(await edited.json()).columnId).toBe(firstColumn);

    const sub = await post({ title: "Sub", parentId: "OPA-1" });
    expect(sub.status).toBe(201);
    expect(await code(await moveTo("OPA-2", { columnId: null, version: 1 }))).toEqual([
      409,
      "subtask_follows_parent",
      undefined,
    ]);
    expect(await code(await patch("OPA-2", { sprintId: planned.id, version: 1 }))).toEqual([
      400,
      "invalid_request",
      ["sprintId"],
    ]);

    const backToBacklog = await moveTo("OPA-1", {
      columnId: null,
      sprintId: planned.id,
      version: 2,
    });
    expect(backToBacklog.status).toBe(200);
    expect(taskSchema.parse(await backToBacklog.json()).sprint?.id).toBe(planned.id);
    expect(await code(await post({ title: "Bad", sprintId: "not-a-uuid" }))).toEqual([
      400,
      "invalid_request",
      ["sprintId"],
    ]);

    await getDb().execute(sql`
      update sprints set state = 'completed', completed_at = now(), total_points = 0,
        completed_points = 0
      where id = ${active.id}`);
    const done = await post({ title: "Done" });
    expect(done.status).toBe(201);
    await getDb().execute(
      sql`update tasks set sprint_id = ${active.id}, column_id = ${firstColumn ?? null} where number = 3`,
    );
    expect(await code(await patch("OPA-3", { sprintId: null, version: 1 }))).toEqual([
      409,
      "sprint_completed",
      undefined,
    ]);

    await updateProject(owner, "OPA", { sprintsEnabled: false, version: 2 });
    expect(await code(await patch("OPA-3", { sprintId: planned.id, version: 1 }))).toEqual([
      409,
      "sprints_disabled",
      undefined,
    ]);
  });
});
