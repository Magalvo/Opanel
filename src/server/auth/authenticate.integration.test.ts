import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb } from "@/server/db/client";
import { sessions } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { generateApiToken } from "./api-token";
import { authenticate } from "./authenticate";
import {
  createTestAccount,
  createTestAgent,
  createTestToken,
  setDisabled,
  signInCookie,
} from "./testing";

function request(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/v1/me", { headers });
}

async function status(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error.status;
    throw error;
  }
  return 200;
}

describe("authenticate", () => {
  it("turns a valid session cookie into the account's actor", async () => {
    const account = await createTestAccount({ role: "manager" });
    const cookie = await signInCookie();

    const result = await authenticate(request({ Cookie: cookie }));

    expect(result.actor).toMatchObject({ kind: "human", accountId: account.id, role: "manager" });
    expect(result.actor.permissions.has("epics:manage")).toBe(true);
    expect(result.actor.permissions.has("accounts:manage")).toBe(false);
    expect(result.account.email).toBe("ada@example.com");
  });

  it("returns the id of the session row the cookie belongs to", async () => {
    const account = await createTestAccount();
    await signInCookie();
    const cookie = await signInCookie();
    const rows = await getDb().select().from(sessions).where(eq(sessions.accountId, account.id));
    // The cookie value is the session token, a dot, and its signature.
    const value = cookie
      .split("; ")
      .find((pair) => pair.startsWith("opanel.session_token="))
      ?.slice("opanel.session_token=".length);
    const token = decodeURIComponent(value ?? "").split(".")[0];

    const result = await authenticate(request({ Cookie: cookie }));

    expect(rows).toHaveLength(2);
    expect(result).toMatchObject({
      via: "session",
      sessionId: rows.find((row) => row.token === token)?.id,
    });
  });

  it("answers 401 with no cookie, a garbage cookie, a deleted session or an expired one", async () => {
    const account = await createTestAccount();
    const cookie = await signInCookie();

    expect(await status(authenticate(request({})))).toBe(401);
    expect(await status(authenticate(request({ Cookie: "opanel.session_token=garbage" })))).toBe(
      401,
    );

    await getDb()
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.accountId, account.id));
    expect(await status(authenticate(request({ Cookie: cookie })))).toBe(401);

    await getDb().delete(sessions);
    expect(await status(authenticate(request({ Cookie: cookie })))).toBe(401);
  });

  it("answers 401 for a deactivated account even with a live session", async () => {
    const account = await createTestAccount();
    const cookie = await signInCookie();
    await setDisabled(account.id, true);

    expect(await status(authenticate(request({ Cookie: cookie })))).toBe(401);
  });

  it("answers 401 to a malformed Authorization header, ignoring a valid cookie", async () => {
    await createTestAccount();
    const cookie = await signInCookie();

    expect(
      await status(authenticate(request({ Cookie: cookie, Authorization: "Bearer opk_x_y" }))),
    ).toBe(401);
  });
});

describe("authenticate with an API token (WS-072)", () => {
  const bearer = (token: string) => request({ Authorization: `Bearer ${token}` });

  it("turns a valid token into its agent's actor, scopes and restriction", async () => {
    const agent = await createTestAgent({
      role: "worker_agent",
      scopes: ["tasks:read", "tasks:write"],
      projectIds: null,
    });
    const { token, id } = await createTestToken(agent.id);

    const result = await authenticate(bearer(token));

    expect(result.via).toBe("token");
    expect(result.actor).toMatchObject({
      kind: "agent",
      accountId: agent.id,
      role: "worker_agent",
    });
    expect(result.actor.permissions).toEqual(new Set(["tasks:read", "tasks:write"]));
    expect(result.actor.projectIds).toBeNull();
    expect(result.account.id).toBe(agent.id);
    expect(result.via === "token" ? result.tokenId : undefined).toBe(id);
    expect([...result.headers]).toEqual([]);
  });

  it("judges by the token alone when a session cookie is sent too", async () => {
    await createTestAccount();
    const cookie = await signInCookie();
    const agent = await createTestAgent();
    const { token } = await createTestToken(agent.id);

    const result = await authenticate(
      request({ Cookie: cookie, Authorization: `Bearer ${token}` }),
    );

    expect(result.actor.accountId).toBe(agent.id);
  });

  it("refuses a malformed header without touching the database", async () => {
    const db = new Proxy(
      {},
      {
        get() {
          throw new Error("the database was used");
        },
      },
    );
    for (const header of ["Bearer nope", "Basic abc", `Bearer opk_${"a".repeat(12)}_xyz`]) {
      expect(
        await status(authenticate(request({ Authorization: header }), { db: db as never })),
      ).toBe(401);
    }
  });

  it("answers the same 401 to an unknown, wrong, expired or revoked token, or a disabled agent", async () => {
    const agent = await createTestAgent();
    const valid = await createTestToken(agent.id);
    const unknown = generateApiToken().token;
    const wrongSecret = `${valid.token.slice(0, 17)}${"0".repeat(64)}`;
    const expired = await createTestToken(agent.id, { expiresAt: new Date(Date.now() - 1000) });
    const revoked = await createTestToken(agent.id, { revokedAt: new Date() });

    const details = new Set<string>();
    for (const token of [unknown, wrongSecret, expired.token, revoked.token]) {
      try {
        await authenticate(bearer(token));
        expect.unreachable(token);
      } catch (error) {
        expect((error as ApiError).status).toBe(401);
        details.add((error as ApiError).detail);
      }
    }
    expect(details.size).toBe(1);

    expect(await status(authenticate(bearer(valid.token)))).toBe(200);
    await setDisabled(agent.id, true);
    expect(await status(authenticate(bearer(valid.token)))).toBe(401);
  });

  it("accepts a token whose expiry is still ahead", async () => {
    const agent = await createTestAgent();
    const { token } = await createTestToken(agent.id, {
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await status(authenticate(bearer(token)))).toBe(200);
  });
});

describe("recording a token's use (WS-072 section 5)", () => {
  async function lastUse(tokenId: string, accountId: string) {
    const [row] = await getDb().$client<{ used: number | null; seen: number | null }[]>`
      select extract(epoch from t.last_used_at)::float8 as used,
        extract(epoch from a.last_seen_at)::float8 as seen
      from api_tokens t join accounts a on a.id = t.account_id
      where t.id = ${tokenId} and a.id = ${accountId}`;
    return row;
  }

  it("writes last_used_at and last_seen_at on first use, and not again within a minute", async () => {
    const agent = await createTestAgent();
    const { token, id } = await createTestToken(agent.id);
    const bearer = request({ Authorization: `Bearer ${token}` });

    await authenticate(bearer);
    const first = await lastUse(id, agent.id);
    expect(first?.used).toEqual(expect.any(Number));
    expect(first?.seen).toEqual(expect.any(Number));

    await authenticate(request({ Authorization: `Bearer ${token}` }));
    expect(await lastUse(id, agent.id)).toEqual(first);

    await getDb()
      .$client`update api_tokens set last_used_at = now() - interval '2 minutes' where id = ${id}`;
    await authenticate(request({ Authorization: `Bearer ${token}` }));
    expect((await lastUse(id, agent.id))?.used).toBeGreaterThan(first?.used ?? 0);
  });

  it("logs a failure to record and still authenticates", async () => {
    const agent = await createTestAgent();
    const { token } = await createTestToken(agent.id);
    const logged: string[] = [];

    const result = await authenticate(request({ Authorization: `Bearer ${token}` }), {
      recordTokenUse: () => Promise.reject(new Error(`secret ${token}`)),
      logError: (line) => logged.push(line),
    });

    expect(result.actor.accountId).toBe(agent.id);
    expect(logged).toHaveLength(1);
    expect(logged[0]).not.toContain(token);
  });
});

describe("authenticate and session renewal (WS-124)", () => {
  const DAY_MS = 86_400_000;

  /** A session past its one-day renewal age: five of its seven days left. */
  async function agedSession() {
    const account = await createTestAccount();
    const cookie = await signInCookie();
    const expiresAt = new Date(Date.now() + 5 * DAY_MS);
    await getDb().update(sessions).set({ expiresAt }).where(eq(sessions.accountId, account.id));
    return { account, cookie, expiresAt };
  }

  async function expiryOf(accountId: string): Promise<number | undefined> {
    const [row] = await getDb().select().from(sessions).where(eq(sessions.accountId, accountId));
    return row?.expiresAt.getTime();
  }

  it("checks a session without extending it when refreshSession is false", async () => {
    const { account, cookie, expiresAt } = await agedSession();

    const result = await authenticate(request({ Cookie: cookie }), { refreshSession: false });

    expect(result.actor).toMatchObject({ kind: "human", accountId: account.id });
    expect(result.headers.get("Set-Cookie")).toBeNull();
    expect(await expiryOf(account.id)).toBe(expiresAt.getTime());
  });

  it("still extends a session by default, and returns its cookie", async () => {
    const { account, cookie } = await agedSession();

    const result = await authenticate(request({ Cookie: cookie }));

    expect(result.headers.get("Set-Cookie")).not.toBeNull();
    expect(await expiryOf(account.id)).toBeGreaterThan(Date.now() + 6.9 * DAY_MS);
  });
});
