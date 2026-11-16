import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestAccount, signInCookie } from "@/server/auth/testing";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const { default: TeamsRoute } = await import("./page");

function withCookie(cookie: string): void {
  vi.mocked(headers).mockResolvedValue(new Headers({ cookie }));
}

describe("the /teams page", () => {
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

    const page = await TeamsRoute();

    expect(page.props).toEqual({ canManageTeams: canManage });
  });

  it("redirects to /sign-in without a session", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers());
    let digest = "";
    try {
      await TeamsRoute();
    } catch (error) {
      digest = (error as { digest?: string }).digest ?? "";
    }

    expect(digest).toContain("NEXT_REDIRECT;replace;/sign-in;");
  });
});
