import { describe, expect, it } from "vitest";
import { z } from "zod";

import { problemSchema } from "@/lib/schemas/problem";
import { projectPageSchema, projectSchema } from "@/lib/schemas/projects";
import { apiRequest, createTestAccount, signInCookie } from "@/server/auth/testing";

import { POST as archive } from "./[projectId]/archive/route";
import { GET as getOne, PATCH } from "./[projectId]/route";
import { POST as unarchive } from "./[projectId]/unarchive/route";
import { GET, POST } from "./route";

function project(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

async function cookieFor(role: "viewer" | "member" | "manager" | "admin") {
  await createTestAccount({ name: role, email: `${role}@example.com`, role });
  return signInCookie(`${role}@example.com`);
}

const versionConflictSchema = problemSchema.extend({
  code: z.literal("version_conflict"),
  current: projectSchema,
});

describe("project endpoints", () => {
  it("create, list, read by key, update, conflict, archive and unarchive", async () => {
    const cookie = await cookieFor("manager");

    const created = await POST(
      apiRequest("POST", "/api/v1/projects", { cookie, body: { key: "OPA", name: "Opanel" } }),
      undefined,
    );
    expect(created.status).toBe(201);
    const opa = projectSchema.parse(await created.json());

    const list = await GET(apiRequest("GET", "/api/v1/projects", { cookie }), undefined);
    expect(projectPageSchema.parse(await list.json()).items.map((item) => item.key)).toEqual([
      "OPA",
    ]);

    const byKey = await getOne(
      apiRequest("GET", "/api/v1/projects/OPA", { cookie }),
      project("OPA"),
    );
    expect(projectSchema.parse(await byKey.json())).toEqual(opa);

    const updated = await PATCH(
      apiRequest("PATCH", `/api/v1/projects/${opa.id}`, {
        cookie,
        body: { name: "New", version: 1 },
      }),
      project(opa.id),
    );
    expect(updated.status).toBe(200);
    expect(projectSchema.parse(await updated.json()).version).toBe(2);

    const stale = await PATCH(
      apiRequest("PATCH", "/api/v1/projects/OPA", { cookie, body: { name: "Old", version: 1 } }),
      project("OPA"),
    );
    expect(stale.status).toBe(409);
    expect(versionConflictSchema.parse(await stale.json()).current.name).toBe("New");

    const archived = await archive(
      apiRequest("POST", "/api/v1/projects/OPA/archive", { cookie }),
      project("OPA"),
    );
    expect(archived.status).toBe(200);
    expect(projectSchema.parse(await archived.json()).archivedAt).not.toBeNull();

    const blocked = await PATCH(
      apiRequest("PATCH", "/api/v1/projects/OPA", { cookie, body: { name: "X", version: 2 } }),
      project("OPA"),
    );
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: "project_archived" });

    const restored = await unarchive(
      apiRequest("POST", "/api/v1/projects/OPA/unarchive", { cookie }),
      project("OPA"),
    );
    expect(projectSchema.parse(await restored.json()).archivedAt).toBeNull();
  });

  it("answers 409 project_key_taken, 400 for invalid input and 404 for an unknown project", async () => {
    const cookie = await cookieFor("admin");
    await POST(
      apiRequest("POST", "/api/v1/projects", { cookie, body: { key: "OPA", name: "O" } }),
      undefined,
    );

    const taken = await POST(
      apiRequest("POST", "/api/v1/projects", { cookie, body: { key: "OPA", name: "Other" } }),
      undefined,
    );
    const lower = await POST(
      apiRequest("POST", "/api/v1/projects", { cookie, body: { key: "web", name: "W" } }),
      undefined,
    );
    const unknown = await getOne(
      apiRequest("GET", "/api/v1/projects/NOPE", { cookie }),
      project("NOPE"),
    );

    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ code: "project_key_taken" });
    expect(lower.status).toBe(400);
    expect(unknown.status).toBe(404);
  });

  it("lets every role read, gives 403 to Viewer and Member on the four writes, and 401 without a session", async () => {
    const managerCookie = await cookieFor("manager");
    await POST(
      apiRequest("POST", "/api/v1/projects", {
        cookie: managerCookie,
        body: { key: "OPA", name: "O" },
      }),
      undefined,
    );

    const writes = (cookie?: string) => {
      const options = cookie === undefined ? {} : { cookie };
      return [
        POST(
          apiRequest("POST", "/api/v1/projects", { ...options, body: { key: "NEW", name: "N" } }),
          undefined,
        ),
        PATCH(
          apiRequest("PATCH", "/api/v1/projects/OPA", {
            ...options,
            body: { name: "Y", version: 1 },
          }),
          project("OPA"),
        ),
        archive(apiRequest("POST", "/api/v1/projects/OPA/archive", options), project("OPA")),
        unarchive(apiRequest("POST", "/api/v1/projects/OPA/unarchive", options), project("OPA")),
      ];
    };
    const reads = (cookie?: string) => {
      const options = cookie === undefined ? {} : { cookie };
      return [
        GET(apiRequest("GET", "/api/v1/projects", options), undefined),
        getOne(apiRequest("GET", "/api/v1/projects/OPA", options), project("OPA")),
      ];
    };
    const statuses = async (responses: Promise<Response>[]) =>
      (await Promise.all(responses)).map((response) => response.status);

    for (const role of ["viewer", "member"] as const) {
      const cookie = await cookieFor(role);
      expect(await statuses(writes(cookie)), role).toEqual([403, 403, 403, 403]);
      expect(await statuses(reads(cookie)), role).toEqual([200, 200]);
    }
    expect(await statuses(writes())).toEqual([401, 401, 401, 401]);
    expect(await statuses(reads())).toEqual([401, 401]);
  });
});
