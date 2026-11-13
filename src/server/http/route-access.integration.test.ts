import { describe, expect, it, vi } from "vitest";

import type { EndpointContract } from "@/lib/openapi/contract";
import { problemSchema } from "@/lib/schemas/problem";
import type { Authenticated } from "@/server/auth/authenticate";
import { apiRequest, createTestAccount, signInCookie } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { sessions } from "@/server/db/schema";

import { json, noContent, route } from "./route";

// The access a contract declares is enforced by route() before the handler runs (WS-025).

const permissionThing = {
  method: "post",
  path: "/api/v1/things",
  summary: "Needs accounts:manage",
  access: { kind: "permission", permission: "accounts:manage" },
  responses: { 204: { description: "Done.", noContent: true } },
} satisfies EndpointContract;

const readThing = {
  method: "get",
  path: "/api/v1/things",
  summary: "Needs accounts:manage",
  access: { kind: "permission", permission: "accounts:manage" },
  responses: { 200: { description: "Who.", noContent: true } },
} satisfies EndpointContract;

const ownThing = {
  method: "get",
  path: "/api/v1/own-thing",
  summary: "Any signed-in account",
  access: { kind: "authenticated" },
  responses: { 200: { description: "Who.", noContent: true } },
} satisfies EndpointContract;

async function codeOf(response: Response): Promise<string> {
  return problemSchema.parse(await response.json()).code;
}

async function signedIn(role: "viewer" | "admin"): Promise<string> {
  await createTestAccount({ email: `${role}@example.com`, role });
  return signInCookie(`${role}@example.com`);
}

/** Moves every session close to its expiry, so Better Auth extends it on the next use. */
async function makeSessionsDueForExtension(): Promise<void> {
  await getDb()
    .update(sessions)
    .set({ expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
}

describe("route() enforces the access its contract declares", () => {
  it("answers 401 without a session and does not call the handler", async () => {
    const handler = vi.fn(() => noContent());

    const response = await route(readThing, handler)(
      apiRequest("GET", "/api/v1/things"),
      undefined,
    );

    expect(response.status).toBe(401);
    expect(await codeOf(response)).toBe("unauthenticated");
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers 403 to an account without the permission, and hands an Admin to the handler", async () => {
    const handler = vi.fn((_request: Request, _context: unknown, auth: Authenticated) =>
      json({ role: auth.actor.role, accountId: auth.account.id }),
    );
    const wrapped = route(readThing, handler);

    const viewer = await wrapped(
      apiRequest("GET", "/api/v1/things", { cookie: await signedIn("viewer") }),
      undefined,
    );
    expect(viewer.status).toBe(403);
    expect(await codeOf(viewer)).toBe("forbidden");
    expect(handler).not.toHaveBeenCalled();

    const admin = await wrapped(
      apiRequest("GET", "/api/v1/things", { cookie: await signedIn("admin") }),
      undefined,
    );
    expect(admin.status).toBe(200);
    expect(await admin.json()).toMatchObject({ role: "admin" });
  });

  it("checks the origin before authenticating: a cross-site request extends no session", async () => {
    const cookie = await signedIn("admin");
    await makeSessionsDueForExtension();
    const handler = vi.fn(() => noContent());

    const response = await route(permissionThing, handler)(
      apiRequest("POST", "/api/v1/things", {
        cookie,
        headers: { Origin: "https://evil.example" },
      }),
      undefined,
    );

    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("lets any signed-in account through an authentication-only operation", async () => {
    const handler = vi.fn((_request: Request, _context: unknown, auth: Authenticated) =>
      json({ role: auth.actor.role }),
    );

    const response = await route(ownThing, handler)(
      apiRequest("GET", "/api/v1/own-thing", { cookie: await signedIn("viewer") }),
      undefined,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ role: "viewer" });
  });

  it("adds the cookies of an extended session to a response that sets none of its own", async () => {
    const cookie = await signedIn("viewer");
    await makeSessionsDueForExtension();

    const response = await route(ownThing, () => json({ ok: true }))(
      apiRequest("GET", "/api/v1/own-thing", { cookie }),
      undefined,
    );

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().length).toBeGreaterThan(0);
  });

  it("keeps only the handler's own cookies when it sets some", async () => {
    const cookie = await signedIn("viewer");
    await makeSessionsDueForExtension();
    const own = new Headers();
    own.append("Set-Cookie", "opanel.session_token=; Max-Age=0; Path=/");

    const response = await route(ownThing, () => noContent(own))(
      apiRequest("GET", "/api/v1/own-thing", { cookie }),
      undefined,
    );

    expect(response.headers.getSetCookie()).toEqual(["opanel.session_token=; Max-Age=0; Path=/"]);
  });
});
