import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestAccount, signInCookie } from "@/server/auth/testing";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const { default: TeamRoute } = await import("./page");

const TEAM_ID = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

function withCookie(cookie: string): void {
  vi.mocked(headers).mockResolvedValue(new Headers({ cookie }));
}

function params(teamId: string) {
  return { params: Promise.resolve({ teamId }) };
}

describe("the /teams/{teamId} page", () => {
  beforeEach(() => {
    vi.mocked(headers).mockReset();
  });

  it.each([
    ["admin", true],
    ["manager", true],
    ["member", false],
    ["viewer", false],
  ] as const)("renders for a %s, with canManageTeams %s", async (role, canManage) => {
    await createTestAccount({ role });
    withCookie(await signInCookie());

    const page = await TeamRoute(params(TEAM_ID));

    expect(page.props).toEqual({ teamId: TEAM_ID, canManageTeams: canManage });
  });

  it("is a not-found page for a path that is not a team id", async () => {
    await createTestAccount({ role: "manager" });
    withCookie(await signInCookie());

    await expect(TeamRoute(params("frontend"))).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  });

  it("redirects to /sign-in without a session", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers());
    let digest = "";
    try {
      await TeamRoute(params(TEAM_ID));
    } catch (error) {
      digest = (error as { digest?: string }).digest ?? "";
    }

    expect(digest).toContain("NEXT_REDIRECT;replace;/sign-in;");
  });
});
