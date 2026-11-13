import { describe, expect, it } from "vitest";
import { z } from "zod";

import { columnListSchema, columnSchema } from "@/lib/schemas/columns";
import { problemSchema } from "@/lib/schemas/problem";
import { apiRequest, createTestAccount, signInCookie } from "@/server/auth/testing";

import { GET as list, POST as create } from "../../projects/[projectId]/columns/route";
import { POST as projectsPost } from "../../projects/route";
import { POST as move } from "./move/route";
import { DELETE, PATCH } from "./route";

function project(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

function column(columnId: string) {
  return { params: Promise.resolve({ columnId }) };
}

async function cookieFor(role: "viewer" | "member" | "manager" | "admin") {
  await createTestAccount({ name: role, email: `${role}@example.com`, role });
  return signInCookie(`${role}@example.com`);
}

const conflictSchema = problemSchema.extend({
  code: z.literal("version_conflict"),
  current: columnSchema,
});

async function columnsOf(cookie: string) {
  const response = await list(
    apiRequest("GET", "/api/v1/projects/OPA/columns", { cookie }),
    project("OPA"),
  );
  expect(response.status).toBe(200);
  return columnListSchema.parse(await response.json()).items;
}

describe("column endpoints", () => {
  it("list, create, update, conflict, move and delete", async () => {
    const cookie = await cookieFor("manager");
    await projectsPost(
      apiRequest("POST", "/api/v1/projects", { cookie, body: { key: "OPA", name: "O" } }),
      undefined,
    );

    const created = await create(
      apiRequest("POST", "/api/v1/projects/OPA/columns", {
        cookie,
        body: { name: "Review", category: "in_progress" },
      }),
      project("OPA"),
    );
    expect(created.status).toBe(201);
    const review = columnSchema.parse(await created.json());

    const updated = await PATCH(
      apiRequest("PATCH", `/api/v1/columns/${review.id}`, {
        cookie,
        body: { name: "QA", version: 1 },
      }),
      column(review.id),
    );
    expect(columnSchema.parse(await updated.json())).toMatchObject({ name: "QA", version: 2 });

    const stale = await PATCH(
      apiRequest("PATCH", `/api/v1/columns/${review.id}`, {
        cookie,
        body: { name: "X", version: 1 },
      }),
      column(review.id),
    );
    expect(stale.status).toBe(409);
    expect(conflictSchema.parse(await stale.json()).current.name).toBe("QA");

    const moved = await move(
      apiRequest("POST", `/api/v1/columns/${review.id}/move`, {
        cookie,
        body: { afterColumnId: null, version: 2 },
      }),
      column(review.id),
    );
    expect(moved.status).toBe(200);
    expect((await columnsOf(cookie)).map((item) => item.name)).toEqual([
      "QA",
      "To do",
      "In progress",
      "Done",
    ]);

    const deleted = await DELETE(
      apiRequest("DELETE", `/api/v1/columns/${review.id}`, { cookie }),
      column(review.id),
    );
    expect(deleted.status).toBe(204);

    const done = (await columnsOf(cookie)).find((item) => item.category === "done");
    const last = await DELETE(
      apiRequest("DELETE", `/api/v1/columns/${done?.id ?? ""}`, { cookie }),
      column(done?.id ?? ""),
    );
    expect(last.status).toBe(409);
    expect(await last.json()).toMatchObject({ code: "last_done_column" });
  });

  it("lets every role list, gives 403 to Viewer and Member on the four writes, and 401 without a session", async () => {
    const managerCookie = await cookieFor("manager");
    await projectsPost(
      apiRequest("POST", "/api/v1/projects", {
        cookie: managerCookie,
        body: { key: "OPA", name: "O" },
      }),
      undefined,
    );
    const [first] = await columnsOf(managerCookie);
    const id = first?.id ?? "";

    const writes = (cookie?: string) => {
      const options = cookie === undefined ? {} : { cookie };
      return [
        create(
          apiRequest("POST", "/api/v1/projects/OPA/columns", {
            ...options,
            body: { name: "X", category: "todo" },
          }),
          project("OPA"),
        ),
        PATCH(
          apiRequest("PATCH", `/api/v1/columns/${id}`, {
            ...options,
            body: { name: "Y", version: 1 },
          }),
          column(id),
        ),
        move(
          apiRequest("POST", `/api/v1/columns/${id}/move`, {
            ...options,
            body: { afterColumnId: null, version: 1 },
          }),
          column(id),
        ),
        DELETE(apiRequest("DELETE", `/api/v1/columns/${id}`, options), column(id)),
      ];
    };
    const statuses = async (responses: Promise<Response>[]) =>
      (await Promise.all(responses)).map((response) => response.status);

    for (const role of ["viewer", "member"] as const) {
      const cookie = await cookieFor(role);
      expect(await statuses(writes(cookie)), role).toEqual([403, 403, 403, 403]);
      expect(await columnsOf(cookie), role).toHaveLength(3);
    }
    expect(await statuses(writes())).toEqual([401, 401, 401, 401]);
    const anonymous = await list(apiRequest("GET", "/api/v1/projects/OPA/columns"), project("OPA"));
    expect(anonymous.status).toBe(401);
  });
});
