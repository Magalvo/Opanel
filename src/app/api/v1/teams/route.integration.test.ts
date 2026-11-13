import { describe, expect, it } from "vitest";

import { teamPageSchema, teamSchema } from "@/lib/schemas/teams";
import { apiRequest, createTestAccount, signInCookie } from "@/server/auth/testing";

import { DELETE as removeMember } from "./[teamId]/members/[accountId]/route";
import { POST as addMember } from "./[teamId]/members/route";
import { DELETE, GET as getOne, PATCH } from "./[teamId]/route";
import { GET, POST } from "./route";

function team(teamId: string) {
  return { params: Promise.resolve({ teamId }) };
}

function member(teamId: string, accountId: string) {
  return { params: Promise.resolve({ teamId, accountId }) };
}

async function cookieFor(role: "viewer" | "member" | "manager" | "admin", name: string = role) {
  await createTestAccount({ name, email: `${role}@example.com`, role });
  return signInCookie(`${role}@example.com`);
}

async function created(cookie: string, name: string) {
  const response = await POST(
    apiRequest("POST", "/api/v1/teams", { cookie, body: { name } }),
    undefined,
  );
  expect(response.status).toBe(201);
  return teamSchema.parse(await response.json());
}

describe("team endpoints", () => {
  it("create, read, rename, add and remove a member, and delete a team", async () => {
    const cookie = await cookieFor("manager", "Manager");
    const ada = await createTestAccount({ name: "Ada", email: "ada@example.com" });

    const frontend = await created(cookie, "  Frontend ");
    expect(frontend).toMatchObject({ name: "Frontend", members: [] });

    const list = await GET(apiRequest("GET", "/api/v1/teams", { cookie }), undefined);
    expect(list.status).toBe(200);
    expect(teamPageSchema.parse(await list.json()).items).toEqual([
      expect.objectContaining({ id: frontend.id, name: "Frontend", memberCount: 0 }),
    ]);

    const renamed = await PATCH(
      apiRequest("PATCH", `/api/v1/teams/${frontend.id}`, { cookie, body: { name: "Web" } }),
      team(frontend.id),
    );
    expect(renamed.status).toBe(200);
    expect(teamSchema.parse(await renamed.json()).name).toBe("Web");

    const added = await addMember(
      apiRequest("POST", `/api/v1/teams/${frontend.id}/members`, {
        cookie,
        body: { accountId: ada.id },
      }),
      team(frontend.id),
    );
    expect(added.status).toBe(200);
    expect(teamSchema.parse(await added.json()).members).toEqual([
      { id: ada.id, name: "Ada", active: true },
    ]);

    const read = await getOne(
      apiRequest("GET", `/api/v1/teams/${frontend.id}`, { cookie }),
      team(frontend.id),
    );
    expect(read.status).toBe(200);
    expect(teamSchema.parse(await read.json()).members).toHaveLength(1);

    const removed = await removeMember(
      apiRequest("DELETE", `/api/v1/teams/${frontend.id}/members/${ada.id}`, { cookie }),
      member(frontend.id, ada.id),
    );
    expect(removed.status).toBe(204);

    const deleted = await DELETE(
      apiRequest("DELETE", `/api/v1/teams/${frontend.id}`, { cookie }),
      team(frontend.id),
    );
    expect(deleted.status).toBe(204);
    const gone = await getOne(
      apiRequest("GET", `/api/v1/teams/${frontend.id}`, { cookie }),
      team(frontend.id),
    );
    expect(gone.status).toBe(404);
  });

  it("answers 409 team_name_taken and 400 for invalid input", async () => {
    const cookie = await cookieFor("admin");
    await created(cookie, "API");

    const taken = await POST(
      apiRequest("POST", "/api/v1/teams", { cookie, body: { name: "api" } }),
      undefined,
    );
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ code: "team_name_taken" });

    const invalid = await POST(
      apiRequest("POST", "/api/v1/teams", { cookie, body: { name: "" } }),
      undefined,
    );
    expect(invalid.status).toBe(400);

    const badId = await getOne(apiRequest("GET", "/api/v1/teams/abc", { cookie }), team("abc"));
    expect(badId.status).toBe(400);
  });

  it("lets every role read, gives 403 to Viewer and Member on the five writes, and 401 without a session", async () => {
    const managerCookie = await cookieFor("manager");
    const target = await created(managerCookie, "Backend");
    const ada = await createTestAccount({ name: "Ada", email: "ada@example.com" });

    const writes = (cookie?: string) => {
      const options = cookie === undefined ? {} : { cookie };
      return [
        POST(apiRequest("POST", "/api/v1/teams", { ...options, body: { name: "X" } }), undefined),
        PATCH(
          apiRequest("PATCH", `/api/v1/teams/${target.id}`, { ...options, body: { name: "Y" } }),
          team(target.id),
        ),
        DELETE(apiRequest("DELETE", `/api/v1/teams/${target.id}`, options), team(target.id)),
        addMember(
          apiRequest("POST", `/api/v1/teams/${target.id}/members`, {
            ...options,
            body: { accountId: ada.id },
          }),
          team(target.id),
        ),
        removeMember(
          apiRequest("DELETE", `/api/v1/teams/${target.id}/members/${ada.id}`, options),
          member(target.id, ada.id),
        ),
      ];
    };
    const reads = (cookie?: string) => {
      const options = cookie === undefined ? {} : { cookie };
      return [
        GET(apiRequest("GET", "/api/v1/teams", options), undefined),
        getOne(apiRequest("GET", `/api/v1/teams/${target.id}`, options), team(target.id)),
      ];
    };
    const statuses = async (responses: Promise<Response>[]) =>
      (await Promise.all(responses)).map((response) => response.status);

    for (const role of ["viewer", "member"] as const) {
      const cookie = await cookieFor(role);
      expect(await statuses(writes(cookie)), role).toEqual([403, 403, 403, 403, 403]);
      expect(await statuses(reads(cookie)), role).toEqual([200, 200]);
    }
    expect(await statuses(writes())).toEqual([401, 401, 401, 401, 401]);
    expect(await statuses(reads())).toEqual([401, 401]);
  });
});
