import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/server/db/client";
import { sessions } from "@/server/db/schema";

import { createTestAccount, setDisabled, signInCookie } from "./testing";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const { getSession, requireAccount } = await import("./session");

function withCookie(cookie: string | undefined): void {
  vi.mocked(headers).mockResolvedValue(
    new Headers(cookie === undefined ? {} : { cookie }) as Awaited<ReturnType<typeof headers>>,
  );
}

async function redirectsToSignIn(promise: Promise<unknown>): Promise<boolean> {
  try {
    await promise;
  } catch (error) {
    return (
      (error as { digest?: string }).digest?.startsWith("NEXT_REDIRECT;replace;/sign-in;") === true
    );
  }
  return false;
}

describe("getSession and requireAccount", () => {
  beforeEach(() => {
    vi.mocked(headers).mockReset();
  });

  it("give the account for a valid session cookie", async () => {
    const account = await createTestAccount({ role: "manager" });
    withCookie(await signInCookie());

    const session = await getSession();

    expect(session?.account.id).toBe(account.id);
    expect(session?.actor.role).toBe("manager");
    expect((await requireAccount()).account.id).toBe(account.id);
  });

  it("give null, and redirect to /sign-in, with no cookie or a garbage cookie", async () => {
    withCookie(undefined);
    expect(await getSession()).toBeNull();
    expect(await redirectsToSignIn(requireAccount())).toBe(true);

    withCookie("opanel.session_token=garbage");
    expect(await getSession()).toBeNull();
  });

  it("give null for an expired, a deleted and a deactivated session", async () => {
    const account = await createTestAccount();
    const cookie = await signInCookie();
    withCookie(cookie);

    await getDb()
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.accountId, account.id));
    expect(await getSession()).toBeNull();

    const fresh = await signInCookie();
    withCookie(fresh);
    await setDisabled(account.id, true);
    expect(await getSession()).toBeNull();
    expect(await redirectsToSignIn(requireAccount())).toBe(true);

    await setDisabled(account.id, false);
    await getDb().delete(sessions);
    expect(await getSession()).toBeNull();
  });
});
