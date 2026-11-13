import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestAccount, signInCookie } from "@/server/auth/testing";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const { default: ProfilePage } = await import("./page");

describe("the /profile page", () => {
  beforeEach(() => {
    vi.mocked(headers).mockReset();
  });

  it.each(["viewer", "member", "manager", "admin"] as const)(
    "renders for a %s, with no permission needed",
    async (role) => {
      await createTestAccount({ role });
      vi.mocked(headers).mockResolvedValue(new Headers({ cookie: await signInCookie() }));

      expect(await ProfilePage()).toBeTruthy();
    },
  );

  it("redirects to /sign-in without a session", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers());
    let digest = "";
    try {
      await ProfilePage();
    } catch (error) {
      digest = (error as { digest?: string }).digest ?? "";
    }

    expect(digest).toContain("NEXT_REDIRECT;replace;/sign-in;");
  });
});
