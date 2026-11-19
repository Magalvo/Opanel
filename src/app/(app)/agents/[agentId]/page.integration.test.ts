import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestAccount, signInCookie } from "@/server/auth/testing";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const { default: AgentPage } = await import("./page");

const props = { params: Promise.resolve({ agentId: "7c1f0e9e-2c39-4c1e-9b8e-2b6f4f1c5a01" }) };

function withCookie(cookie: string): void {
  vi.mocked(headers).mockResolvedValue(new Headers({ cookie }));
}

describe("the /agents/{agentId} page (WS-077)", () => {
  beforeEach(() => {
    vi.mocked(headers).mockReset();
  });

  it("renders for an Admin", async () => {
    await createTestAccount({ role: "admin" });
    withCookie(await signInCookie());

    expect(await AgentPage(props)).toBeTruthy();
  });

  it.each(["manager", "member", "viewer"] as const)(
    "is a not-found page for a %s",
    async (role) => {
      await createTestAccount({ role });
      withCookie(await signInCookie());

      await expect(AgentPage(props)).rejects.toMatchObject({
        digest: "NEXT_HTTP_ERROR_FALLBACK;404",
      });
    },
  );

  it("redirects to /sign-in without a session", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers());
    let digest = "";
    try {
      await AgentPage(props);
    } catch (error) {
      digest = (error as { digest?: string }).digest ?? "";
    }

    expect(digest).toContain("NEXT_REDIRECT;replace;/sign-in;");
  });
});
