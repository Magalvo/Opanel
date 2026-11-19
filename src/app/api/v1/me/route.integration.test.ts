import { describe, expect, it, vi } from "vitest";

import { agentMeSchema, humanMeSchema, meResponseSchema } from "@/lib/schemas/auth";
import { problemSchema } from "@/lib/schemas/problem";
import { HUMAN_ROLE_PERMISSIONS } from "@/server/auth/roles";
import {
  apiRequest,
  APP_ORIGIN,
  bearerRequest,
  createTestAccount,
  createTestAgent,
  createTestToken,
  signInCookie,
  testActor,
} from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";
import { createProject } from "@/server/services/projects";

import { GET, PATCH } from "./route";

function request(headers: Record<string, string> = {}): Request {
  return new Request(`${APP_ORIGIN}/api/v1/me`, { headers });
}

describe("GET /api/v1/me", () => {
  it("returns the signed-in account with the permissions of its role", async () => {
    const account = await createTestAccount({ role: "viewer" });
    const cookie = await signInCookie();

    const response = await GET(request({ Cookie: cookie }), undefined);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = humanMeSchema.parse(await response.json());
    expect(body).toMatchObject({
      id: account.id,
      role: "viewer",
      kind: "human",
      email: account.email,
      projectIds: null,
    });
    expect(new Set(body.permissions)).toEqual(HUMAN_ROLE_PERMISSIONS.viewer);
  });

  it("returns an agent its role, scopes and projectIds null, with no email (WS-076)", async () => {
    const agent = await createTestAgent({
      name: "Board Reader",
      scopes: ["tasks:read", "projects:read"],
    });
    const { token } = await createTestToken(agent.id);

    const response = await GET(bearerRequest("/api/v1/me", token), undefined);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const json: unknown = await response.json();
    expect(json).toEqual({
      id: agent.id,
      kind: "agent",
      name: "Board Reader",
      role: "qa_agent",
      permissions: ["projects:read", "tasks:read"],
      projectIds: null,
    });
    expect(agentMeSchema.parse(json)).toEqual(json);
  });

  it("returns a restricted agent its projects and its stored scopes, sorted (WS-076)", async () => {
    const admin = testActor(await createTestAccount({ role: "admin" }));
    const first = await createProject(admin, { key: "MEA", name: "Project MEA" });
    const second = await createProject(admin, { key: "MEB", name: "Project MEB" });
    await createProject(admin, { key: "MEC", name: "Project MEC" });
    const agent = await createTestAgent({
      role: "worker_agent",
      scopes: ["tasks:write", "comments:write", "tasks:read"],
      projectIds: [second.id, first.id],
    });
    const { token } = await createTestToken(agent.id);

    const bodies = [];
    for (let call = 0; call < 2; call += 1) {
      const response = await GET(bearerRequest("/api/v1/me", token), undefined);
      expect(response.status).toBe(200);
      bodies.push(agentMeSchema.parse(await response.json()));
    }

    expect(bodies[0]).toMatchObject({
      kind: "agent",
      role: "worker_agent",
      permissions: ["comments:write", "tasks:read", "tasks:write"],
      projectIds: [first.id, second.id].sort(),
    });
    expect(bodies[1]).toEqual(bodies[0]);
  });

  it("answers 401 without a session, with the problem body", async () => {
    const response = await GET(request(), undefined);

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});

describe("GET /api/v1/me and the query string (WS-083)", () => {
  it("refuses a query parameter it does not take, for a token too", async () => {
    const agent = await createTestAgent({ name: "Curious", scopes: ["tasks:read"] });
    const { token } = await createTestToken(agent.id);

    const response = await GET(bearerRequest("/api/v1/me?x=1", token), undefined);

    expect(response.status).toBe(400);
    expect(problemSchema.parse(await response.json())).toMatchObject({
      code: "invalid_request",
      errors: [{ path: "x", message: "Unknown field" }],
    });
  });
});

describe("PATCH /api/v1/me", () => {
  it("renames a Viewer, with no permission needed, and answers 200 with the Me body", async () => {
    const account = await createTestAccount({ role: "viewer" });
    const cookie = await signInCookie();

    const response = await PATCH(
      apiRequest("PATCH", "/api/v1/me", { cookie, body: { name: " Ada King " } }),
      undefined,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = humanMeSchema.parse(await response.json());
    expect(body).toMatchObject({
      id: account.id,
      name: "Ada King",
      role: "viewer",
      projectIds: null,
    });
    expect(new Set(body.permissions)).toEqual(HUMAN_ROLE_PERMISSIONS.viewer);
    const who = meResponseSchema.parse(
      await (await GET(request({ Cookie: cookie }), undefined)).json(),
    );
    expect(who.name).toBe("Ada King");
  });

  it("answers 401 without a session", async () => {
    const response = await PATCH(
      apiRequest("PATCH", "/api/v1/me", { body: { name: "Ada" } }),
      undefined,
    );

    expect(response.status).toBe(401);
  });

  it("answers 400 per field, 403 for a foreign Origin before reading the body, and 415 for non-JSON", async () => {
    await createTestAccount();
    const cookie = await signInCookie();

    const bad = await PATCH(
      apiRequest("PATCH", "/api/v1/me", { cookie, body: { name: " ", role: "admin" } }),
      undefined,
    );
    expect(bad.status).toBe(400);
    expect(
      problemSchema
        .parse(await bad.json())
        .errors?.map((e) => e.path)
        .sort(),
    ).toEqual(["name", "role"]);

    const foreign = apiRequest("PATCH", "/api/v1/me", {
      cookie,
      body: { name: "Mallory" },
      headers: { Origin: "https://evil.example" },
    });
    const read = vi.spyOn(foreign, "json");
    expect((await PATCH(foreign, undefined)).status).toBe(403);
    expect(read).not.toHaveBeenCalled();

    const plain = new Request(`${APP_ORIGIN}/api/v1/me`, {
      method: "PATCH",
      headers: { Origin: APP_ORIGIN, Cookie: cookie, "Content-Type": "text/plain" },
      body: "x",
    });
    expect((await PATCH(plain, undefined)).status).toBe(415);
    const actions = (await getDb().select().from(auditLog)).map((row) => row.action);
    expect(actions).not.toContain("account.name_changed");
  });
});
