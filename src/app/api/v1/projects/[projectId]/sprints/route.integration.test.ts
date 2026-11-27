// The project's sprint list and creation through their route handlers (WS-140 test 12).
import { describe, expect, it } from "vitest";

import { projectSchema } from "@/lib/schemas/projects";
import { sprintPageSchema, sprintSchema } from "@/lib/schemas/sprints";
import { apiRequest, createTestAccount, signInCookie } from "@/server/auth/testing";

import { POST as createProject } from "../../route";
import { PATCH as patchProject } from "../route";
import { GET as list, POST as create } from "./route";

const project = { params: Promise.resolve({ projectId: "OPA" }) };

async function cookieFor(role: "viewer" | "member" | "manager") {
  await createTestAccount({ name: role, email: `${role}@example.com`, role });
  return signInCookie(`${role}@example.com`);
}

function post(cookie: string, body: unknown) {
  return create(apiRequest("POST", "/api/v1/projects/OPA/sprints", { cookie, body }), project);
}

describe("POST and GET /api/v1/projects/{projectId}/sprints", () => {
  it("creates after the setting is turned on, lists with the state filter, and answers each refusal", async () => {
    const manager = await cookieFor("manager");
    const member = await cookieFor("member");
    await createProject(
      apiRequest("POST", "/api/v1/projects", { cookie: manager, body: { key: "OPA", name: "O" } }),
      undefined,
    );
    const body = { name: "Sprint 1", startDate: "2026-12-01", endDate: "2026-12-14" };

    const disabled = await post(manager, body);
    expect(disabled.status).toBe(409);
    expect(await disabled.json()).toMatchObject({ code: "sprints_disabled" });

    const turnedOn = await patchProject(
      apiRequest("PATCH", "/api/v1/projects/OPA", {
        cookie: manager,
        body: { sprintsEnabled: true, version: 1 },
      }),
      project,
    );
    expect(turnedOn.status).toBe(200);
    expect(projectSchema.parse(await turnedOn.json()).sprintsEnabled).toBe(true);

    const created = await post(manager, { ...body, goal: "Ship sign-in" });
    expect(created.status).toBe(201);
    const sprint = sprintSchema.parse(await created.json());
    expect(sprint).toMatchObject({ name: "Sprint 1", goal: "Ship sign-in", state: "planned" });

    const page = await list(
      apiRequest("GET", "/api/v1/projects/OPA/sprints?state=planned&state=active&limit=10", {
        cookie: member,
      }),
      project,
    );
    expect(page.status).toBe(200);
    expect(sprintPageSchema.parse(await page.json()).items.map((item) => item.id)).toEqual([
      sprint.id,
    ]);
    const completed = await list(
      apiRequest("GET", "/api/v1/projects/OPA/sprints?state=completed", { cookie: member }),
      project,
    );
    expect(sprintPageSchema.parse(await completed.json()).items).toEqual([]);

    const badDates = await post(manager, { ...body, endDate: "2026-11-30" });
    expect(badDates.status).toBe(400);
    expect(await badDates.json()).toMatchObject({
      code: "invalid_request",
      errors: [expect.objectContaining({ path: "endDate" })],
    });
    const badState = await list(
      apiRequest("GET", "/api/v1/projects/OPA/sprints?state=running", { cookie: member }),
      project,
    );
    expect(badState.status).toBe(400);

    const statuses = await Promise.all([
      post(member, body),
      list(apiRequest("GET", "/api/v1/projects/OPA/sprints"), project),
      list(apiRequest("GET", "/api/v1/projects/NOPE/sprints", { cookie: member }), {
        params: Promise.resolve({ projectId: "NOPE" }),
      }),
    ]);
    expect(statuses.map((response) => response.status)).toEqual([403, 401, 404]);
  });

  it("refuses turning sprints off for a Member with 403", async () => {
    const manager = await cookieFor("manager");
    const member = await cookieFor("member");
    await createProject(
      apiRequest("POST", "/api/v1/projects", { cookie: manager, body: { key: "OPA", name: "O" } }),
      undefined,
    );

    const refused = await patchProject(
      apiRequest("PATCH", "/api/v1/projects/OPA", {
        cookie: member,
        body: { sprintsEnabled: true, version: 1 },
      }),
      project,
    );

    expect(refused.status).toBe(403);
  });
});
