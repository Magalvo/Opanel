import { describe, expect, it } from "vitest";

import { APP_ORIGIN, createTestAccount, postRequest, signInCookie } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { auditLog, sessions } from "@/server/db/schema";

import { GET as me } from "../../me/route";
import { POST } from "./route";

const path = "/api/v1/auth/sign-out";

function meRequest(cookie: string): Request {
  return new Request(`${APP_ORIGIN}/api/v1/me`, { headers: { Cookie: cookie } });
}

describe("POST /api/v1/auth/sign-out", () => {
  it("ends the session: 204, row deleted, cookie cleared, old cookie rejected, audited", async () => {
    const account = await createTestAccount();
    const cookie = await signInCookie();
    expect(await getDb().select().from(sessions)).toHaveLength(1);

    const response = await POST(postRequest(path, undefined, { Cookie: cookie }), undefined);

    expect(response.status).toBe(204);
    expect(await getDb().select().from(sessions)).toHaveLength(0);
    expect(response.headers.getSetCookie().join(";")).toMatch(/Max-Age=0|Expires=/i);
    expect((await me(meRequest(cookie), undefined)).status).toBe(401);
    const audit = await getDb().select().from(auditLog);
    expect(audit.at(-1)).toMatchObject({ actorAccountId: account.id, action: "auth.sign_out" });
  });

  it("answers 401 without a session and 403 for a foreign Origin", async () => {
    await createTestAccount();
    const cookie = await signInCookie();

    expect((await POST(postRequest(path), undefined)).status).toBe(401);
    const foreign = await POST(
      postRequest(path, undefined, { Cookie: cookie, Origin: "https://evil.example" }),
      undefined,
    );
    expect(foreign.status).toBe(403);
    expect(await getDb().select().from(sessions)).toHaveLength(1);
  });
});
