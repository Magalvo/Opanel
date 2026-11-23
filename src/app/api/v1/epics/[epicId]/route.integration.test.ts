import { describe, expect, it } from "vitest";

import { epicPageSchema, epicSchema } from "@/lib/schemas/epics";
import { apiRequest, createTestAccount, signInCookie } from "@/server/auth/testing";

import { GET as list, POST as create } from "../../projects/[projectId]/epics/route";
import { POST as createProject } from "../../projects/route";
import { GET, PATCH } from "./route";

const project = { params: Promise.resolve({ projectId: "OPA" }) };

function epic(epicId: string) {
  return { params: Promise.resolve({ epicId }) };
}

async function cookieFor(role: "viewer" | "member" | "manager") {
  await createTestAccount({ name: role, email: `${role}@example.com`, role });
  return signInCookie(`${role}@example.com`);
}

describe("epic endpoints", () => {
  it("create, list, read, update and conflict, with the documented refusals", async () => {
    const manager = await cookieFor("manager");
    const member = await cookieFor("member");
    const viewer = await cookieFor("viewer");
    await createProject(
      apiRequest("POST", "/api/v1/projects", { cookie: manager, body: { key: "OPA", name: "O" } }),
      undefined,
    );

    const created = await create(
      apiRequest("POST", "/api/v1/projects/OPA/epics", {
        cookie: manager,
        body: { title: "Sign-in" },
      }),
      project,
    );
    expect(created.status).toBe(201);
    const signIn = epicSchema.parse(await created.json());

    const page = await list(
      apiRequest("GET", "/api/v1/projects/OPA/epics", { cookie: viewer }),
      project,
    );
    expect(epicPageSchema.parse(await page.json()).items.map((item) => item.title)).toEqual([
      "Sign-in",
    ]);
    const read = await GET(
      apiRequest("GET", `/api/v1/epics/${signIn.id}`, { cookie: member }),
      epic(signIn.id),
    );
    expect(read.status).toBe(200);

    const closed = await PATCH(
      apiRequest("PATCH", `/api/v1/epics/${signIn.id}`, {
        cookie: manager,
        body: { status: "closed", version: 1 },
      }),
      epic(signIn.id),
    );
    expect(epicSchema.parse(await closed.json()).status).toBe("closed");
    const stale = await PATCH(
      apiRequest("PATCH", `/api/v1/epics/${signIn.id}`, {
        cookie: manager,
        body: { title: "X", version: 1 },
      }),
      epic(signIn.id),
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: "version_conflict",
      current: { status: "closed" },
    });

    const statuses = await Promise.all([
      create(
        apiRequest("POST", "/api/v1/projects/OPA/epics", { cookie: member, body: { title: "X" } }),
        project,
      ),
      PATCH(
        apiRequest("PATCH", `/api/v1/epics/${signIn.id}`, {
          cookie: viewer,
          body: { title: "X", version: 2 },
        }),
        epic(signIn.id),
      ),
      list(apiRequest("GET", "/api/v1/projects/OPA/epics"), project),
      GET(apiRequest("GET", `/api/v1/epics/${signIn.id}`), epic(signIn.id)),
    ]);
    expect(statuses.map((response) => response.status)).toEqual([403, 403, 401, 401]);
  });

  it("answers 400 for a date in the year 0000, naming the field, and changes nothing (WS-114)", async () => {
    const manager = await cookieFor("manager");
    await createProject(
      apiRequest("POST", "/api/v1/projects", { cookie: manager, body: { key: "OPA", name: "O" } }),
      undefined,
    );
    const created = await create(
      apiRequest("POST", "/api/v1/projects/OPA/epics", {
        cookie: manager,
        body: { title: "Sign-in" },
      }),
      project,
    );
    const signIn = epicSchema.parse(await created.json());

    const badCreate = await create(
      apiRequest("POST", "/api/v1/projects/OPA/epics", {
        cookie: manager,
        body: { title: "Year zero", startDate: "0000-01-01" },
      }),
      project,
    );
    expect(badCreate.status).toBe(400);
    expect(await badCreate.json()).toMatchObject({
      code: "invalid_request",
      errors: [expect.objectContaining({ path: "startDate" })],
    });

    const badUpdate = await PATCH(
      apiRequest("PATCH", `/api/v1/epics/${signIn.id}`, {
        cookie: manager,
        body: { targetDate: "0000-01-01", version: 1 },
      }),
      epic(signIn.id),
    );
    expect(badUpdate.status).toBe(400);
    expect(await badUpdate.json()).toMatchObject({
      code: "invalid_request",
      errors: [expect.objectContaining({ path: "targetDate" })],
    });

    const page = await list(
      apiRequest("GET", "/api/v1/projects/OPA/epics", { cookie: manager }),
      project,
    );
    expect(epicPageSchema.parse(await page.json()).items).toMatchObject([
      { title: "Sign-in", targetDate: null, version: 1 },
    ]);
  });
});

describe("epic list paging (WS-081)", () => {
  it("pages across titles of 200 characters, ASCII and CJK, each epic once and in order", async () => {
    const manager = await cookieFor("manager");
    await createProject(
      apiRequest("POST", "/api/v1/projects", { cookie: manager, body: { key: "OPA", name: "O" } }),
      undefined,
    );
    const titles = ["a", `b${"x".repeat(199)}`, `b${"名".repeat(199)}`, "c"];
    for (const title of titles) {
      const created = await create(
        apiRequest("POST", "/api/v1/projects/OPA/epics", { cookie: manager, body: { title } }),
        project,
      );
      expect(created.status).toBe(201);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor === null ? "" : `&cursor=${cursor}`;
      const response = await list(
        apiRequest("GET", `/api/v1/projects/OPA/epics?limit=1${query}`, { cookie: manager }),
        project,
      );
      expect(response.status).toBe(200);
      const page = epicPageSchema.parse(await response.json());
      seen.push(...page.items.map((item) => item.title));
      cursor = page.nextCursor;
    } while (cursor !== null && seen.length <= titles.length);

    expect(seen).toEqual(titles);
  });
});
