import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestAccount, signInCookie } from "@/server/auth/testing";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const { default: EpicsRoute } = await import("./page");

function withCookie(cookie: string): void {
  vi.mocked(headers).mockResolvedValue(new Headers({ cookie }));
}

function args(show?: string | string[]) {
  return { searchParams: Promise.resolve(show === undefined ? {} : { show }) };
}

describe("the /projects/KEY/epics page (WS-039)", () => {
  beforeEach(() => {
    vi.mocked(headers).mockReset();
  });

  it.each([
    ["admin", true],
    ["manager", true],
    ["member", false],
    ["viewer", false],
  ] as const)("renders for a %s with canManageEpics %s", async (role, canManage) => {
    await createTestAccount({ role });
    withCookie(await signInCookie());

    const page = await EpicsRoute(args());

    expect(page.props).toEqual({ show: "open", canManageEpics: canManage });
    expect(page.key).toBe("open");
  });

  it("reads Show from the URL, Open for anything else", async () => {
    await createTestAccount({ role: "member" });
    withCookie(await signInCookie());

    for (const [given, show] of [
      ["closed", "closed"],
      ["all", "all"],
      ["open", "open"],
      ["nonsense", "open"],
      [["closed", "all"] as string[], "open"],
    ] as const) {
      const page = await EpicsRoute(args(given));
      expect(page.props, String(given)).toMatchObject({ show });
    }
  });

  it("redirects to /sign-in without a session", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers());

    await expect(EpicsRoute(args())).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT;replace;/sign-in;") as unknown,
    });
  });
});
