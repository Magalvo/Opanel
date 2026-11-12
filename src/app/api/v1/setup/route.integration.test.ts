import { describe, expect, it, vi } from "vitest";

import { accountSummarySchema, meResponseSchema } from "@/lib/schemas/auth";
import { problemSchema } from "@/lib/schemas/problem";
import {
  APP_ORIGIN,
  cookieHeaderFrom,
  createTestAccount,
  postRequest,
} from "@/server/auth/testing";
import { HUMAN_ROLE_PERMISSIONS } from "@/server/auth/roles";
import { getDb } from "@/server/db/client";
import { accounts, auditLog, sessions } from "@/server/db/schema";

import { GET as me } from "../me/route";
import { POST } from "./route";

const path = "/api/v1/setup";
const body = { name: "Ada Admin", email: "ada@example.com", password: "a very long password" };

describe("POST /api/v1/setup", () => {
  it("creates the first admin: 201, the account, a hardened cookie that authenticates /me as admin", async () => {
    const response = await POST(postRequest(path, body), undefined);

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(accountSummarySchema.parse(await response.json())).toMatchObject({
      email: "ada@example.com",
      role: "admin",
    });
    const [cookie] = response.headers.getSetCookie();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const who = await me(
      new Request(`${APP_ORIGIN}/api/v1/me`, {
        headers: { Cookie: cookieHeaderFrom(response.headers) },
      }),
      undefined,
    );
    const identity = meResponseSchema.parse(await who.json());
    expect(identity.role).toBe("admin");
    expect(new Set(identity.permissions)).toEqual(HUMAN_ROLE_PERMISSIONS.admin);
  });

  it("answers 404 with the problem body of an unknown path once an account exists", async () => {
    await createTestAccount();

    const response = await POST(postRequest(path, body), undefined);

    expect(response.status).toBe(404);
    expect(problemSchema.parse(await response.json()).code).toBe("not_found");
    expect(await getDb().select().from(accounts)).toHaveLength(1);
  });

  it("answers 400 per field without echoing the password, 403 for a foreign Origin, 415 for non-JSON", async () => {
    const short = await POST(postRequest(path, { ...body, password: "short-secret" }), undefined);
    expect(short.status).toBe(400);
    const text = await short.text();
    expect(text).not.toContain("short-secret");
    expect(problemSchema.parse(JSON.parse(text)).errors?.map((e) => e.path)).toEqual(["password"]);

    const request = postRequest(path, body, { Origin: "https://evil.example" });
    const read = vi.spyOn(request, "json");
    expect((await POST(request, undefined)).status).toBe(403);
    expect(read).not.toHaveBeenCalled();

    const plain = new Request(`${APP_ORIGIN}${path}`, {
      method: "POST",
      headers: { Origin: APP_ORIGIN, "Content-Type": "text/plain" },
      body: "x",
    });
    expect((await POST(plain, undefined)).status).toBe(415);
    expect(await getDb().select().from(accounts)).toHaveLength(0);
  });

  it("leaks no password, hash or session token into the response, the logs or the audit log", async () => {
    const marker = "Marker-Password-5d1e-90bc";
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      }),
    );

    const response = await POST(postRequest(path, { ...body, password: marker }), undefined);
    const text = await response.text();
    spies.forEach((spy) => spy.mockRestore());

    const [session] = await getDb().select().from(sessions);
    const audit = JSON.stringify(await getDb().select().from(auditLog));
    for (const haystack of [text, audit, logged.join("\n")]) {
      expect(haystack).not.toContain(marker);
      expect(haystack).not.toContain("$argon2");
      expect(haystack).not.toContain(session?.token ?? "no-token");
    }
  });
});
