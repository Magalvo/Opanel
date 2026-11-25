import { describe, expect, it, vi } from "vitest";

import type { EndpointContract } from "@/lib/openapi/contract";
import { problemSchema } from "@/lib/schemas/problem";
import { generateApiToken } from "@/server/auth/api-token";
import { authenticate } from "@/server/auth/authenticate";
import { createFailedTokenLimiter, getFailedTokenLimiter } from "@/server/auth/failed-token-limit";
import {
  APP_ORIGIN,
  apiRequest,
  createTestAccount,
  createTestAgent,
  createTestToken,
  signInCookie,
} from "@/server/auth/testing";
import { createTokenRateLimiter } from "@/server/auth/token-rate-limit";

import { noContent, route } from "./route";

// Failed API token attempts are limited per trusted client address (WS-125).

const readTasks = {
  method: "get",
  path: "/api/v1/read-tasks",
  summary: "Needs tasks:read",
  access: { kind: "permission", permission: "tasks:read" },
  responses: { 204: { description: "Done.", noContent: true } },
} satisfies EndpointContract;

const HEADER = "x-forwarded-for";

function tokenRequest(authorization: string, headers: Record<string, string> = {}): Request {
  return new Request(`${APP_ORIGIN}/api/v1/read-tasks`, {
    headers: { Authorization: authorization, ...headers },
  });
}

function from(address: string, token: string, extra: Record<string, string> = {}): Request {
  return tokenRequest(`Bearer ${token}`, { "X-Forwarded-For": address, ...extra });
}

/** Well-formed, but no such token exists. */
function wrongToken(): string {
  return generateApiToken().token;
}

async function validToken(): Promise<string> {
  const agent = await createTestAgent({ role: "worker_agent", scopes: ["tasks:read"] });
  return (await createTestToken(agent.id)).token;
}

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function setup(options: { clientIpHeader?: string | null; now?: () => number } = {}) {
  const failedTokenLimiter = createFailedTokenLimiter({
    limit: 3,
    windowMs: 60_000,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const logError = vi.fn<(message: string) => void>();
  const handler = route(readTasks, () => noContent(), {
    failedTokenLimiter,
    clientIpHeader: options.clientIpHeader === undefined ? HEADER : options.clientIpHeader,
    logError,
  });
  return { failedTokenLimiter, logError, handler };
}

/** A problem body without its request id, which differs on every response. */
async function bodyOf(response: Response): Promise<unknown> {
  const { requestId: _requestId, ...rest } = problemSchema.parse(await response.json());
  return rest;
}

describe("route() limits failed API token attempts per address (WS-125)", () => {
  it("answers a stable 429 with Retry-After once an address has failed the limit", async () => {
    const { handler } = setup();

    for (let i = 0; i < 3; i += 1) {
      expect((await handler(from("203.0.113.9", wrongToken()), {})).status).toBe(401);
    }
    for (let i = 0; i < 17; i += 1) {
      const response = await handler(from("203.0.113.9", wrongToken()), {});
      expect(response.status).toBe(429);
      expect(problemSchema.parse(await response.json()).code).toBe("rate_limited");
      const retryAfter = Number(response.headers.get("Retry-After"));
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(60);
    }
  });

  it("refuses before the lookup: even a valid token, until the window ends", async () => {
    const time = clock();
    const { handler } = setup({ now: time.now });
    const token = await validToken();

    for (let i = 0; i < 3; i += 1) await handler(from("203.0.113.9", wrongToken()), {});
    expect((await handler(from("203.0.113.9", token), {})).status).toBe(429);

    time.advance(60_000);
    expect((await handler(from("203.0.113.9", token), {})).status).toBe(204);
  });

  it("cannot be evaded by forged forwarding headers, and spares other addresses", async () => {
    const { handler } = setup();
    const token = await validToken();

    for (let i = 0; i < 3; i += 1) {
      const forged = `198.51.100.${String(i)}, 203.0.113.9`;
      await handler(from(forged, wrongToken(), { "X-Real-IP": `192.0.2.${String(i)}` }), {});
    }
    const forged = await handler(
      from("192.0.2.200, 203.0.113.9", wrongToken(), { "X-Real-IP": "192.0.2.201" }),
      {},
    );
    expect(forged.status).toBe(429);

    expect((await handler(from("198.51.100.7", token), {})).status).toBe(204);
  });

  it("counts the IPv6 addresses of one /64 together", async () => {
    const { handler } = setup();
    for (let i = 1; i <= 3; i += 1) {
      await handler(from(`2001:db8:1:2::${String(i)}`, wrongToken()), {});
    }
    expect((await handler(from("2001:db8:1:2::ffff", wrongToken()), {})).status).toBe(429);
    expect((await handler(from("2001:db8:1:3::1", wrongToken()), {})).status).toBe(401);
  });

  it("never counts valid tokens, session requests or direct authenticate() calls", async () => {
    const { handler, failedTokenLimiter } = setup();
    const token = await validToken();

    for (let i = 0; i < 50; i += 1) {
      expect((await handler(from("203.0.113.9", token), {})).status).toBe(204);
    }
    for (let i = 0; i < 3; i += 1) {
      expect((await handler(from("203.0.113.9", wrongToken()), {})).status).toBe(401);
    }

    const sessionLimiter = createFailedTokenLimiter({ limit: 3 });
    const sessionHandler = route(readTasks, () => noContent(), {
      failedTokenLimiter: sessionLimiter,
      clientIpHeader: HEADER,
    });
    await createTestAccount({ email: "ada@example.com", role: "admin" });
    const cookie = await signInCookie("ada@example.com");
    const bySession = apiRequest("GET", "/api/v1/read-tasks", {
      cookie,
      headers: { "X-Forwarded-For": "203.0.113.9" },
    });
    expect((await sessionHandler(bySession, {})).status).toBe(204);
    expect(sessionLimiter.size()).toBe(0);

    // The event stream's heartbeat calls authenticate() directly: never counted.
    const shared = getFailedTokenLimiter();
    const before = shared.size();
    await expect(authenticate(from("203.0.113.9", wrongToken()))).rejects.toMatchObject({
      status: 401,
    });
    expect(shared.size()).toBe(before);
    expect(failedTokenLimiter.keys()).toEqual(["ip:203.0.113.9"]);
  });

  it("keeps every 401 identical, and its 429 the same as the per-token limit's", async () => {
    const { handler } = setup({ clientIpHeader: null });
    const real = await validToken();
    const publicId = /^opk_([a-z2-7]{12})_/.exec(real)?.[1] ?? "";
    const agent = await createTestAgent({ role: "worker_agent", scopes: ["tasks:read"] });
    const revoked = await createTestToken(agent.id, { revokedAt: new Date() });
    const expired = await createTestToken(agent.id, { expiresAt: new Date(Date.now() - 1000) });
    const disabledAgent = await createTestAgent({
      role: "worker_agent",
      scopes: ["tasks:read"],
      disabled: true,
    });
    const ofDisabled = await createTestToken(disabledAgent.id);

    const authorizations = [
      "Bearer not-a-token",
      `Bearer ${wrongToken()}`,
      `Bearer opk_${publicId}_${"0".repeat(64)}`,
      `Bearer ${revoked.token}`,
      `Bearer ${expired.token}`,
      `Bearer ${ofDisabled.token}`,
    ];
    const bodies = [];
    for (const authorization of authorizations) {
      const response = await handler(tokenRequest(authorization), {});
      expect(response.status).toBe(401);
      bodies.push(await bodyOf(response));
    }
    for (const body of bodies) expect(body).toEqual(bodies[0]);

    const byAddress = setup();
    for (let i = 0; i < 3; i += 1) await byAddress.handler(from("203.0.113.9", wrongToken()), {});
    const addressLimited = await byAddress.handler(from("203.0.113.9", wrongToken()), {});

    const perToken = route(readTasks, () => noContent(), {
      tokenRateLimiter: createTokenRateLimiter({ limit: 1 }),
      failedTokenLimiter: createFailedTokenLimiter(),
      clientIpHeader: null,
    });
    await perToken(tokenRequest(`Bearer ${real}`), {});
    const tokenLimited = await perToken(tokenRequest(`Bearer ${real}`), {});

    expect(addressLimited.status).toBe(429);
    expect(tokenLimited.status).toBe(429);
    expect(await bodyOf(addressLimited)).toEqual(await bodyOf(tokenLimited));
  });

  it("does not limit without a trusted address header", async () => {
    const { handler, failedTokenLimiter } = setup({ clientIpHeader: null });
    for (let i = 0; i < 50; i += 1) {
      const response = await handler(from(`198.51.100.${String(i)}`, wrongToken()), {});
      expect(response.status).toBe(401);
    }
    expect(failedTokenLimiter.size()).toBe(0);
  });

  it("logs the first refusal once, with the address and nothing of the token", async () => {
    const { handler, logError, failedTokenLimiter } = setup();
    const tokens = Array.from({ length: 6 }, wrongToken);

    for (const token of tokens) await handler(from("203.0.113.9", token), {});

    expect(logError).toHaveBeenCalledTimes(1);
    const line = logError.mock.calls[0]?.[0] ?? "";
    expect(line).toContain("203.0.113.9");
    for (const token of tokens) {
      const [, publicId = "", secret = ""] = /^opk_([a-z2-7]{12})_([0-9a-f]{64})$/.exec(token) ?? [];
      for (const part of [publicId, secret, secret.slice(0, 8)]) {
        expect(line).not.toContain(part);
        for (const key of failedTokenLimiter.keys()) expect(key).not.toContain(part);
      }
    }
  });
});
