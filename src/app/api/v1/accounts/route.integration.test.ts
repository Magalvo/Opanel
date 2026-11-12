import { describe, expect, it, vi } from "vitest";

import { accountPageSchema, inviteResponseSchema } from "@/lib/schemas/accounts";
import { problemSchema } from "@/lib/schemas/problem";
import { apiRequest, createTestAccount, signInCookie } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { accounts, auditLog, sessions } from "@/server/db/schema";

import { GET, POST } from "./route";

async function adminCookie(): Promise<string> {
  await createTestAccount({ email: "admin@example.com", role: "admin" });
  return signInCookie("admin@example.com");
}

describe("GET /api/v1/accounts", () => {
  it("returns a page of accounts and a cursor for the next one", async () => {
    const cookie = await adminCookie();
    await createTestAccount({ email: "b@example.com" });
    await createTestAccount({ email: "c@example.com" });

    const first = await GET(apiRequest("GET", "/api/v1/accounts?limit=2", { cookie }), undefined);
    const page = accountPageSchema.parse(await first.json());

    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();

    const second = await GET(
      apiRequest("GET", `/api/v1/accounts?limit=2&cursor=${page.nextCursor ?? ""}`, { cookie }),
      undefined,
    );
    const rest = accountPageSchema.parse(await second.json());
    expect(rest.items).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();
  });

  it("answers 400 for an unknown parameter, an out-of-range limit and a tampered cursor", async () => {
    const cookie = await adminCookie();

    for (const query of ["sort=name", "limit=101", "limit=0", "cursor=garbage"]) {
      const response = await GET(
        apiRequest("GET", `/api/v1/accounts?${query}`, { cookie }),
        undefined,
      );
      expect(response.status, query).toBe(400);
      expect(problemSchema.parse(await response.json()).code).toBe("invalid_request");
    }
  });

  it("answers 401 without a session", async () => {
    expect((await GET(apiRequest("GET", "/api/v1/accounts"), undefined)).status).toBe(401);
  });
});

describe("POST /api/v1/accounts", () => {
  const body = { name: "Grace", email: "grace@example.com", role: "member" };

  it("invites: 201 with the account and a one-time link that is in no later response", async () => {
    const cookie = await adminCookie();

    const response = await POST(
      apiRequest("POST", "/api/v1/accounts", { cookie, body }),
      undefined,
    );

    expect(response.status).toBe(201);
    const created = inviteResponseSchema.parse(await response.json());
    expect(created.account).toMatchObject({ email: "grace@example.com", status: "invited" });
    expect(created.link.url).toMatch(/^http:\/\/localhost:3000\/accept#[A-Za-z0-9_-]{43,}$/);
    const token = new URL(created.link.url).hash.slice(1);

    const list = await GET(apiRequest("GET", "/api/v1/accounts", { cookie }), undefined);
    expect(await list.text()).not.toContain(token);
  });

  it("answers 409 for a duplicate email, 400 per field, 415 for non-JSON", async () => {
    const cookie = await adminCookie();
    await POST(apiRequest("POST", "/api/v1/accounts", { cookie, body }), undefined);

    expect(
      (await POST(apiRequest("POST", "/api/v1/accounts", { cookie, body }), undefined)).status,
    ).toBe(409);

    const bad = await POST(
      apiRequest("POST", "/api/v1/accounts", {
        cookie,
        body: { name: "", email: "x", role: "qa_agent" },
      }),
      undefined,
    );
    expect(bad.status).toBe(400);
    expect(
      problemSchema
        .parse(await bad.json())
        .errors?.map((e) => e.path)
        .sort(),
    ).toEqual(["email", "name", "role"]);

    const text = new Request("http://localhost:3000/api/v1/accounts", {
      method: "POST",
      headers: { Origin: "http://localhost:3000", Cookie: cookie, "Content-Type": "text/plain" },
      body: "x",
    });
    expect((await POST(text, undefined)).status).toBe(415);
  });

  it("answers 403 for a foreign Origin before the body is read", async () => {
    const cookie = await adminCookie();
    const request = apiRequest("POST", "/api/v1/accounts", {
      cookie,
      body,
      headers: { Origin: "https://evil.example" },
    });
    const read = vi.spyOn(request, "json");

    expect((await POST(request, undefined)).status).toBe(403);
    expect(read).not.toHaveBeenCalled();
    expect(await getDb().select().from(accounts)).toHaveLength(1);
  });

  it("puts no hash, session token or link token in the logs or the audit log", async () => {
    const cookie = await adminCookie();
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      }),
    );

    const response = await POST(
      apiRequest("POST", "/api/v1/accounts", { cookie, body }),
      undefined,
    );
    const text = await response.text();
    spies.forEach((spy) => {
      spy.mockRestore();
    });

    const token = new URL(inviteResponseSchema.parse(JSON.parse(text)).link.url).hash.slice(1);
    const [session] = await getDb().select().from(sessions);
    const audit = JSON.stringify(await getDb().select().from(auditLog));
    for (const haystack of [audit, logged.join("\n")]) {
      expect(haystack).not.toContain(token);
      expect(haystack).not.toContain("$argon2");
      expect(haystack).not.toContain(session?.token ?? "no-token");
    }
    expect(text).not.toContain("$argon2");
  });
});
