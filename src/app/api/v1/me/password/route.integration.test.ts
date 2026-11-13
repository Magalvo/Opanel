import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { problemSchema } from "@/lib/schemas/problem";
import {
  apiRequest,
  APP_ORIGIN,
  createTestAccount,
  signInCookie,
  TEST_PASSWORD,
} from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { auditLog, credentials, sessions } from "@/server/db/schema";

import { GET as me } from "../route";
import { POST } from "./route";

const path = "/api/v1/me/password";
const NEW_PASSWORD = "a brand new password 123";

function change(cookie: string | undefined, body: unknown, headers: Record<string, string> = {}) {
  return apiRequest("POST", path, { ...(cookie === undefined ? {} : { cookie }), body, headers });
}

function meStatus(cookie: string): Promise<number> {
  return me(
    new Request(`${APP_ORIGIN}/api/v1/me`, { headers: { Cookie: cookie } }),
    undefined,
  ).then((response) => response.status);
}

describe("POST /api/v1/me/password", () => {
  it("answers 204, keeps the caller signed in and signs out the account's other sessions", async () => {
    await createTestAccount({ role: "viewer" });
    const elsewhere = await signInCookie();
    const cookie = await signInCookie();

    const response = await POST(
      change(cookie, { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD }),
      undefined,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await meStatus(cookie)).toBe(200);
    expect(await meStatus(elsewhere)).toBe(401);
  });

  it("answers 400 on currentPassword for a wrong current password, not 401", async () => {
    await createTestAccount();
    const cookie = await signInCookie();

    const response = await POST(
      change(cookie, { currentPassword: "not my password at all", newPassword: NEW_PASSWORD }),
      undefined,
    );

    expect(response.status).toBe(400);
    const body = problemSchema.parse(await response.json());
    expect(body.code).toBe("invalid_request");
    expect(body.errors?.map((e) => e.path)).toEqual(["currentPassword"]);
    expect(await meStatus(cookie)).toBe(200);
  });

  it("answers 429 with Retry-After after 10 attempts", async () => {
    await createTestAccount();
    const cookie = await signInCookie();
    for (let i = 0; i < 10; i++) {
      await POST(
        change(cookie, { currentPassword: "wrong", newPassword: NEW_PASSWORD }),
        undefined,
      );
    }

    const response = await POST(
      change(cookie, { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD }),
      undefined,
    );

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("answers 401 without a session, 400 per field without echoing a password, 403 for a foreign Origin before reading the body, 415 for non-JSON", async () => {
    const account = await createTestAccount();
    const cookie = await signInCookie();

    expect(
      (
        await POST(
          change(undefined, { currentPassword: "x", newPassword: NEW_PASSWORD }),
          undefined,
        )
      ).status,
    ).toBe(401);

    const bad = await POST(
      change(cookie, { currentPassword: "", newPassword: "tiny-secret", extra: 1 }),
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
    ).toEqual(["currentPassword", "extra", "newPassword"]);

    const foreign = change(
      cookie,
      { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD },
      { Origin: "https://evil.example" },
    );
    const read = vi.spyOn(foreign, "json");
    expect((await POST(foreign, undefined)).status).toBe(403);
    expect(read).not.toHaveBeenCalled();

    const plain = new Request(`${APP_ORIGIN}${path}`, {
      method: "POST",
      headers: { Origin: APP_ORIGIN, Cookie: cookie, "Content-Type": "text/plain" },
      body: "x",
    });
    expect((await POST(plain, undefined)).status).toBe(415);

    const [credential] = await getDb()
      .select()
      .from(credentials)
      .where(eq(credentials.accountId, account.id));
    expect(credential?.updatedAt.getTime()).toBe(credential?.createdAt.getTime());
  });

  it("leaks no password, hash or session token into the response, the logs or the audit log", async () => {
    await createTestAccount();
    const cookie = await signInCookie();
    const marker = "Marker-Password-7b3a-41e0";
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      }),
    );

    const wrong = await POST(
      change(cookie, { currentPassword: marker, newPassword: marker }),
      undefined,
    );
    const right = await POST(
      change(cookie, { currentPassword: TEST_PASSWORD, newPassword: marker }),
      undefined,
    );
    const texts = [await wrong.text(), await right.text()];
    spies.forEach((spy) => {
      spy.mockRestore();
    });

    expect(right.status).toBe(204);
    const [session] = await getDb().select().from(sessions);
    const audit = JSON.stringify(await getDb().select().from(auditLog));
    for (const haystack of [...texts, audit, logged.join("\n")]) {
      expect(haystack).not.toContain(marker);
      expect(haystack).not.toContain(TEST_PASSWORD);
      expect(haystack).not.toContain("$argon2");
      expect(haystack).not.toContain(session?.token ?? "no-token");
    }
  });
});
