// The label endpoints, and labelIds on the task endpoints (WS-107 test 13).
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { labelListSchema, labelSchema } from "@/lib/schemas/labels";
import { AGENT_SCOPES } from "@/lib/schemas/permissions";
import { problemSchema } from "@/lib/schemas/problem";
import { taskSchema } from "@/lib/schemas/tasks";
import {
  apiRequest,
  bearerRequest,
  createTestAccount,
  createTestAgent,
  createTestToken,
  signInCookie,
} from "@/server/auth/testing";

import { GET as list, POST as create } from "../../projects/[projectId]/labels/route";
import { POST as createTask } from "../../projects/[projectId]/tasks/route";
import { POST as projectsPost } from "../../projects/route";
import { PATCH as patchTask } from "../../tasks/[taskId]/route";
import { DELETE, PATCH } from "./route";

function project(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

function label(labelId: string) {
  return { params: Promise.resolve({ labelId }) };
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
  current: labelSchema,
});

describe("label endpoints (WS-107)", () => {
  it("list, create, update, conflict and delete, by a Member and an Admin", async () => {
    const admin = await cookieFor("admin");
    const member = await cookieFor("member");
    await projectsPost(
      apiRequest("POST", "/api/v1/projects", { cookie: admin, body: { key: "OPA", name: "O" } }),
      undefined,
    );

    const created = await create(
      apiRequest("POST", "/api/v1/projects/OPA/labels", {
        cookie: member,
        body: { name: "Bug", colour: "red" },
      }),
      project("OPA"),
    );
    expect(created.status).toBe(201);
    const bug = labelSchema.parse(await created.json());
    expect(bug).toMatchObject({ name: "Bug", colour: "red", version: 1 });

    const duplicate = await create(
      apiRequest("POST", "/api/v1/projects/OPA/labels", { cookie: member, body: { name: "bug" } }),
      project("OPA"),
    );
    expect(duplicate.status).toBe(409);
    expect(problemSchema.parse(await duplicate.json()).code).toBe("label_name_taken");

    const byMember = await PATCH(
      apiRequest("PATCH", `/api/v1/labels/${bug.id}`, {
        cookie: member,
        body: { name: "Defect", version: 1 },
      }),
      label(bug.id),
    );
    expect(byMember.status).toBe(403);

    const updated = await PATCH(
      apiRequest("PATCH", `/api/v1/labels/${bug.id}`, {
        cookie: admin,
        body: { name: "Defect", colour: "pink", version: 1 },
      }),
      label(bug.id),
    );
    expect(updated.status).toBe(200);
    expect(labelSchema.parse(await updated.json())).toMatchObject({ name: "Defect", version: 2 });

    const stale = await PATCH(
      apiRequest("PATCH", `/api/v1/labels/${bug.id}`, {
        cookie: admin,
        body: { colour: "gray", version: 1 },
      }),
      label(bug.id),
    );
    expect(stale.status).toBe(409);
    expect(conflictSchema.parse(await stale.json()).current).toMatchObject({ version: 2 });

    const listed = await list(
      apiRequest("GET", "/api/v1/projects/OPA/labels", { cookie: member }),
      project("OPA"),
    );
    expect(listed.status).toBe(200);
    expect(labelListSchema.parse(await listed.json()).items.map((each) => each.name)).toEqual([
      "Defect",
    ]);

    const deleted = await DELETE(
      apiRequest("DELETE", `/api/v1/labels/${bug.id}`, { cookie: admin }),
      label(bug.id),
    );
    expect(deleted.status).toBe(204);
    const gone = await DELETE(
      apiRequest("DELETE", `/api/v1/labels/${bug.id}`, { cookie: admin }),
      label(bug.id),
    );
    expect(gone.status).toBe(404);
  });

  it("takes labelIds on the task endpoints from a Member, never from an agent", async () => {
    const member = await cookieFor("member");
    const manager = await cookieFor("manager");
    await projectsPost(
      apiRequest("POST", "/api/v1/projects", { cookie: manager, body: { key: "OPA", name: "O" } }),
      undefined,
    );
    const bug = labelSchema.parse(
      await (
        await create(
          apiRequest("POST", "/api/v1/projects/OPA/labels", {
            cookie: member,
            body: { name: "Bug", colour: "red" },
          }),
          project("OPA"),
        )
      ).json(),
    );

    const made = await createTask(
      apiRequest("POST", "/api/v1/projects/OPA/tasks", {
        cookie: member,
        body: { title: "T", labelIds: [bug.id] },
      }),
      project("OPA"),
    );
    expect(made.status).toBe(201);
    expect(taskSchema.parse(await made.json()).labels).toEqual([
      { id: bug.id, name: "Bug", colour: "red" },
    ]);
    const cleared = await patchTask(
      apiRequest("PATCH", "/api/v1/tasks/OPA-1", {
        cookie: member,
        body: { labelIds: [], version: 1 },
      }),
      task("OPA-1"),
    );
    expect(cleared.status).toBe(200);
    expect(taskSchema.parse(await cleared.json()).labels).toEqual([]);

    const agent = await createTestAgent({
      name: "Worker",
      role: "worker_agent",
      scopes: [...AGENT_SCOPES],
    });
    const { token } = await createTestToken(agent.id);
    const byAgent = await patchTask(
      bearerRequest("/api/v1/tasks/OPA-1", token, {
        method: "PATCH",
        body: JSON.stringify({ labelIds: [bug.id], version: 2 }),
      }),
      task("OPA-1"),
    );
    expect(byAgent.status).toBe(403);
    const createdByAgent = await createTask(
      bearerRequest("/api/v1/projects/OPA/tasks", token, {
        method: "POST",
        body: JSON.stringify({ title: "A", labelIds: [bug.id] }),
      }),
      project("OPA"),
    );
    expect(createdByAgent.status).toBe(403);
    const labelByAgent = await create(
      bearerRequest("/api/v1/projects/OPA/labels", token, {
        method: "POST",
        body: JSON.stringify({ name: "Agent" }),
      }),
      project("OPA"),
    );
    expect(labelByAgent.status).toBe(403);
    const listByAgent = await list(
      bearerRequest("/api/v1/projects/OPA/labels", token),
      project("OPA"),
    );
    expect(listByAgent.status).toBe(200);
  });
});
