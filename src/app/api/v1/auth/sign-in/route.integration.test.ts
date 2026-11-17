import { describe, expect, it, vi } from "vitest";

import { accountSummarySchema } from "@/lib/schemas/auth";
import { problemSchema } from "@/lib/schemas/problem";
import type * as HashGate from "@/server/auth/hash-gate";
import { APP_ORIGIN, createTestAccount, postRequest, TEST_PASSWORD } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { auditLog, rateLimits, sessions } from "@/server/db/schema";
import { serverBusy } from "@/server/http/errors";

import { POST } from "./route";

const path = "/api/v1/auth/sign-in";

// The process hash gate, real unless a test fills it (WS-056).
const gateState = vi.hoisted(() => ({ full: false }));
vi.mock("@/server/auth/hash-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof HashGate>();
  return {
    ...actual,
    hashGate: {
      run: <T>(task: () => Promise<T>): Promise<T> =>
        gateState.full ? Promise.reject(serverBusy()) : actual.hashGate.run(task),
    },
  };
});

describe("POST /api/v1/auth/sign-in", () => {
  it("returns 200 with the account and a hardened session cookie", async () => {
    const account = await createTestAccount();

    const response = await POST(
      postRequest(path, { email: "ada@example.com", password: TEST_PASSWORD }),
      undefined,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(accountSummarySchema.parse(await response.json()).id).toBe(account.id);
    const [cookie] = response.headers.getSetCookie();
    expect(cookie).toMatch(/^opanel\.session_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).not.toMatch(/;\s*Secure/i);
  });

  it("answers 401 with the problem body, identically for a wrong password and an unknown email", async () => {
    await createTestAccount();

    const wrong = await POST(
      postRequest(path, { email: "ada@example.com", password: "wrong password!" }),
      undefined,
    );
    const unknown = await POST(
      postRequest(path, { email: "nobody@example.com", password: "wrong password!" }),
      undefined,
    );

    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("content-type")).toContain("application/problem+json");
    const a = problemSchema.parse(await wrong.json());
    const b = problemSchema.parse(await unknown.json());
    expect({ ...a, requestId: "" }).toEqual({ ...b, requestId: "" });
    expect(a.code).toBe("unauthenticated");
    expect(wrong.headers.getSetCookie()).toEqual([]);
  });

  it("answers 429 with Retry-After once the limit is reached", async () => {
    for (let i = 0; i < 10; i++) {
      await POST(postRequest(path, { email: "ada@example.com", password: "x" }), undefined);
    }

    const response = await POST(
      postRequest(path, { email: "ada@example.com", password: "x" }),
      undefined,
    );

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("cannot sign in past the limiter: the 11th attempt is refused even with the right password", async () => {
    await createTestAccount();
    for (let i = 0; i < 10; i++) {
      await POST(
        postRequest(path, { email: "ada@example.com", password: "wrong password!" }),
        undefined,
      );
    }

    const right = await POST(
      postRequest(path, { email: "ada@example.com", password: TEST_PASSWORD }),
      undefined,
    );
    const claimingTrust = await POST(
      postRequest(path, { email: "ada@example.com", password: TEST_PASSWORD, trusted: true }),
      undefined,
    );

    expect(right.status).toBe(429);
    expect(claimingTrust.status).toBe(400);
  });

  it.each([
    ["an existing account, through Better Auth's own verify", "ada@example.com"],
    ["an unknown email, through the dummy verify", "nobody@example.com"],
  ])(
    "answers 429 server_busy with Retry-After 1 while the hash gate is full: %s (WS-056)",
    async (_case, email) => {
      await createTestAccount();
      gateState.full = true;
      let response: Response;
      try {
        response = await POST(postRequest(path, { email, password: TEST_PASSWORD }), undefined);
      } finally {
        gateState.full = false;
      }

      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("1");
      const problem = problemSchema.parse(await response.json());
      expect(problem.code).toBe("server_busy");
      expect(problem.requestId).toBe(response.headers.get("x-request-id"));
      const actions = (await getDb().select().from(auditLog)).map((row) => row.action);
      expect(actions).not.toContain("auth.sign_in");
      expect(await getDb().select().from(sessions)).toHaveLength(0);
    },
  );

  it("rejects a foreign Origin with 403 before reading the body", async () => {
    await createTestAccount();
    const request = postRequest(
      path,
      { email: "ada@example.com", password: TEST_PASSWORD },
      { Origin: "https://evil.example" },
    );
    const read = vi.spyOn(request, "json");

    const response = await POST(request, undefined);

    expect(response.status).toBe(403);
    expect(read).not.toHaveBeenCalled();
    expect(await getDb().select().from(sessions)).toHaveLength(0);
  });

  it("answers 415 for a non-JSON body and 400 for an unknown field", async () => {
    const text = new Request(`${APP_ORIGIN}${path}`, {
      method: "POST",
      headers: { Origin: APP_ORIGIN, "Content-Type": "text/plain" },
      body: "x",
    });
    expect((await POST(text, undefined)).status).toBe(415);

    const unknownField = postRequest(path, {
      email: "a@example.com",
      password: "x",
      remember: true,
    });
    expect((await POST(unknownField, undefined)).status).toBe(400);
  });

  it("leaks no password, hash or session token into the response, the logs or the audit log", async () => {
    const marker = "Marker-Password-9f3a-7c21";
    await createTestAccount({ password: marker });
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      }),
    );

    const ok = await POST(
      postRequest(path, { email: "ada@example.com", password: marker }),
      undefined,
    );
    const okBody = await ok.text();
    const bad = await POST(
      postRequest(path, { email: "ada@example.com", password: `${marker}-wrong` }),
      undefined,
    );
    const badBody = await bad.text();
    spies.forEach((spy) => {
      spy.mockRestore();
    });

    const [session] = await getDb().select().from(sessions);
    const audit = JSON.stringify(await getDb().select().from(auditLog));
    for (const text of [okBody, badBody, audit, logged.join("\n")]) {
      expect(text).not.toContain(marker);
      expect(text).not.toContain("$argon2");
      expect(text).not.toContain(session?.token ?? "no-token");
    }
  });

  it("refuses an oversized body with 413 before signing in: no audit entry, no limiter row (WS-044)", async () => {
    await createTestAccount();
    const body = JSON.stringify({
      email: "ada@example.com",
      password: TEST_PASSWORD,
      padding: "a".repeat(600 * 1024),
    });

    const response = await POST(
      new Request(`${APP_ORIGIN}${path}`, {
        method: "POST",
        headers: { Origin: APP_ORIGIN, "Content-Type": "application/json" },
        body,
      }),
      undefined,
    );

    expect(response.status).toBe(413);
    expect(problemSchema.parse(await response.json()).code).toBe("payload_too_large");
    expect(await getDb().select().from(auditLog)).toEqual([]);
    expect(await getDb().select().from(rateLimits)).toEqual([]);
    expect(await getDb().select().from(sessions)).toEqual([]);
  });
});
