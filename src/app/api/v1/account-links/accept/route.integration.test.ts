import { isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { accountSummarySchema, meResponseSchema } from "@/lib/schemas/auth";
import { problemSchema } from "@/lib/schemas/problem";
import {
  APP_ORIGIN,
  cookieHeaderFrom,
  createTestAccount,
  postRequest,
  testActor,
} from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { accountTokens, auditLog, sessions } from "@/server/db/schema";
import { inviteAccount, issueResetLink } from "@/server/services/account-management";

import { GET as me } from "../../me/route";
import { POST } from "./route";

const path = "/api/v1/account-links/accept";
const password = "a brand new password 123";

async function invitation(): Promise<string> {
  const admin = await createTestAccount({ email: "admin@example.com", role: "admin" });
  const { link } = await inviteAccount(testActor(admin), {
    name: "Grace",
    email: "grace@example.com",
    role: "member",
  });
  return new URL(link.url).hash.slice(1);
}

describe("POST /api/v1/account-links/accept", () => {
  it("sets the password and signs the invited person in: 200, the account, a hardened cookie, and /me agrees", async () => {
    const token = await invitation();

    const response = await POST(postRequest(path, { token, password }), undefined);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(accountSummarySchema.parse(await response.json())).toMatchObject({
      email: "grace@example.com",
      role: "member",
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
    expect(meResponseSchema.parse(await who.json())).toMatchObject({
      name: "Grace",
      role: "member",
    });
  });

  it("gives the same 404 problem body for an unknown, a used and an expired link", async () => {
    const token = await invitation();
    await POST(postRequest(path, { token, password }), undefined);
    const admin = await createTestAccount({ email: "other@example.com", role: "admin" });
    const { link } = await issueResetLink(testActor(admin), admin.id);
    const expired = new URL(link.url).hash.slice(1);
    await getDb()
      .update(accountTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(isNull(accountTokens.usedAt));

    const bodies = [];
    for (const value of ["x".repeat(43), token, expired]) {
      const response = await POST(postRequest(path, { token: value, password }), undefined);
      expect(response.status).toBe(404);
      bodies.push({ ...problemSchema.parse(await response.json()), requestId: "" });
    }

    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect(bodies[0]?.code).toBe("invalid_link");
  });

  it("answers 400 per field without echoing the password, 403 for a foreign Origin before reading the body, 415 for non-JSON", async () => {
    const token = await invitation();

    const bad = await POST(
      postRequest(path, { token: "short", password: "tiny-secret" }),
      undefined,
    );
    expect(bad.status).toBe(400);
    const text = await bad.text();
    expect(text).not.toContain("tiny-secret");
    expect(
      problemSchema
        .parse(JSON.parse(text))
        .errors?.map((e) => e.path)
        .sort(),
    ).toEqual(["password", "token"]);

    const foreign = postRequest(path, { token, password }, { Origin: "https://evil.example" });
    const read = vi.spyOn(foreign, "json");
    expect((await POST(foreign, undefined)).status).toBe(403);
    expect(read).not.toHaveBeenCalled();

    const plain = new Request(`${APP_ORIGIN}${path}`, {
      method: "POST",
      headers: { Origin: APP_ORIGIN, "Content-Type": "text/plain" },
      body: "x",
    });
    expect((await POST(plain, undefined)).status).toBe(415);
    const [link] = await getDb().select().from(accountTokens);
    expect(link?.usedAt).toBeNull();
  });

  it("leaks no password, hash, link token or session token into the response, the logs or the audit log", async () => {
    const token = await invitation();
    const marker = "Marker-Password-1c9e-4d2f";
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      }),
    );

    const response = await POST(postRequest(path, { token, password: marker }), undefined);
    const text = await response.text();
    spies.forEach((spy) => {
      spy.mockRestore();
    });

    const [session] = await getDb().select().from(sessions);
    const audit = JSON.stringify(await getDb().select().from(auditLog));
    for (const haystack of [text, audit, logged.join("\n")]) {
      expect(haystack).not.toContain(marker);
      expect(haystack).not.toContain(token);
      expect(haystack).not.toContain("$argon2");
      expect(haystack).not.toContain(session?.token ?? "no-token");
    }
  });
});
