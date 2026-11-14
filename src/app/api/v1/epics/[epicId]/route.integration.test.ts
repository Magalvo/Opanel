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
});
