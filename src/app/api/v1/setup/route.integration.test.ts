import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { accountSummarySchema, meResponseSchema } from "@/lib/schemas/auth";
import { problemSchema } from "@/lib/schemas/problem";
import { HUMAN_ROLE_PERMISSIONS } from "@/server/auth/roles";
import {
  APP_ORIGIN,
  cookieHeaderFrom,
  createTestAccount,
  postRequest,
} from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { accounts, auditLog, sessions } from "@/server/db/schema";
import type * as Env from "@/server/env";

import { GET as me } from "../me/route";
import { POST } from "./route";

// The configured setup token (WS-050) and mode (WS-055), changed per test; unset and the
// test runner's own mode unless a test sets them.
const configured = vi.hoisted(() => ({
  token: undefined as string | undefined,
  nodeEnv: undefined as "development" | "test" | "production" | undefined,
}));
vi.mock("@/server/env", async (importOriginal) => {
  const actual = await importOriginal<typeof Env>();
  return {
    ...actual,
    getEnv: () => {
      const env = actual.getEnv();
      return {
        ...env,
        SETUP_TOKEN: configured.token,
        NODE_ENV: configured.nodeEnv ?? env.NODE_ENV,
      };
    },
  };
});

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
    const short = await POST(postRequest(path, { ...body, password: "tiny-secret" }), undefined);
    expect(short.status).toBe(400);
    const text = await short.text();
    expect(text).not.toContain("tiny-secret");
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
    spies.forEach((spy) => {
      spy.mockRestore();
    });

    const [session] = await getDb().select().from(sessions);
    const audit = JSON.stringify(await getDb().select().from(auditLog));
    for (const haystack of [text, audit, logged.join("\n")]) {
      expect(haystack).not.toContain(marker);
      expect(haystack).not.toContain("$argon2");
      expect(haystack).not.toContain(session?.token ?? "no-token");
    }
  });

  describe("with a setup token configured (WS-050)", () => {
    const token = "Configured-Token-7c41-0123456789";

    beforeEach(() => {
      configured.token = token;
    });

    afterEach(() => {
      configured.token = undefined;
    });

    it("refuses a missing or wrong token with 403 invalid_setup_token, leaking neither token", async () => {
      const sent = "Sent-Token-Marker-aa11-0123456789";
      const logged: string[] = [];
      const spies = (["log", "info", "warn", "error"] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          logged.push(args.map(String).join(" "));
        }),
      );

      const missing = await POST(postRequest(path, body), undefined);
      const wrong = await POST(postRequest(path, { ...body, setupToken: sent }), undefined);
      const texts = [await missing.text(), await wrong.text()];
      spies.forEach((spy) => {
        spy.mockRestore();
      });

      for (const [response, text] of [
        [missing, texts[0]],
        [wrong, texts[1]],
      ] as const) {
        expect(response.status).toBe(403);
        const problem = problemSchema.parse(JSON.parse(text ?? ""));
        expect(problem.code).toBe("invalid_setup_token");
        expect(problem.requestId).toBe(response.headers.get("x-request-id"));
      }
      for (const haystack of [...texts, logged.join("\n")]) {
        expect(haystack).not.toContain(token);
        expect(haystack).not.toContain(sent);
      }
      expect(await getDb().select().from(accounts)).toHaveLength(0);
    });

    it("creates the first admin with the right token", async () => {
      const response = await POST(postRequest(path, { ...body, setupToken: token }), undefined);

      expect(response.status).toBe(201);
      expect(accountSummarySchema.parse(await response.json()).role).toBe("admin");
    });
  });

  describe("in production with no setup token configured (WS-055)", () => {
    beforeEach(() => {
      configured.nodeEnv = "production";
    });

    afterEach(() => {
      configured.nodeEnv = undefined;
    });

    it("refuses with 403 setup_token_not_configured, logging nothing and creating nothing", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

      try {
        const response = await POST(postRequest(path, body), undefined);

        expect(response.status).toBe(403);
        const problem = problemSchema.parse(await response.json());
        expect(problem.code).toBe("setup_token_not_configured");
        expect(problem.requestId).toBe(response.headers.get("x-request-id"));
        expect(logged).not.toHaveBeenCalled();
      } finally {
        logged.mockRestore();
      }
      expect(await getDb().select().from(accounts)).toHaveLength(0);
    });
  });
});
