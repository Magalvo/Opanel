import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestAccount, signInCookie } from "@/server/auth/testing";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const { default: BacklogRoute } = await import("./page");

function withCookie(cookie: string): void {
  vi.mocked(headers).mockResolvedValue(new Headers({ cookie }));
}

describe("the /projects/KEY/backlog page (WS-109)", () => {
  beforeEach(() => {
    vi.mocked(headers).mockReset();
  });

  it.each([
    ["admin", true],
    ["manager", true],
    ["member", true],
    ["viewer", false],
  ] as const)("renders for a %s with canWriteTasks %s", async (role, canWrite) => {
    await createTestAccount({ role });
    withCookie(await signInCookie());

    const page = await BacklogRoute();

    expect(page.props).toEqual({ canWriteTasks: canWrite });
  });

  it("redirects to /sign-in without a session", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers());

    await expect(BacklogRoute()).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT;replace;/sign-in;") as unknown,
    });
  });
});
