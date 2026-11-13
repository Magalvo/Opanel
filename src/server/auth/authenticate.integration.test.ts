import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb } from "@/server/db/client";
import { sessions } from "@/server/db/schema";
import { ApiError } from "@/server/http/errors";

import { authenticate } from "./authenticate";
import { createTestAccount, setDisabled, signInCookie } from "./testing";

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
    expect(result.sessionId).toBe(rows.find((row) => row.token === token)?.id);
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

  it("answers 401 to any Authorization header, ignoring a valid cookie", async () => {
    await createTestAccount();
    const cookie = await signInCookie();

    expect(
      await status(authenticate(request({ Cookie: cookie, Authorization: "Bearer opk_x_y" }))),
    ).toBe(401);
  });
});
