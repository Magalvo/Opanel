import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestAccount, signInCookie } from "@/server/auth/testing";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const { default: AgentsPage } = await import("./page");

function withCookie(cookie: string): void {
  vi.mocked(headers).mockResolvedValue(new Headers({ cookie }));
}

describe("the /agents page (WS-077)", () => {
  beforeEach(() => {
    vi.mocked(headers).mockReset();
  });

  it("renders for an Admin", async () => {
    await createTestAccount({ role: "admin" });
    withCookie(await signInCookie());

    expect(await AgentsPage()).toBeTruthy();
  });

  it.each(["manager", "member", "viewer"] as const)(
    "is a not-found page for a %s",
    async (role) => {
      await createTestAccount({ role });
      withCookie(await signInCookie());

      await expect(AgentsPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    },
  );

  it("redirects to /sign-in without a session", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers());
    let digest = "";
    try {
      await AgentsPage();
    } catch (error) {
      digest = (error as { digest?: string }).digest ?? "";
    }

    expect(digest).toContain("NEXT_REDIRECT;replace;/sign-in;");
  });
});
