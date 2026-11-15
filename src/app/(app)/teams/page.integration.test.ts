import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestAccount, signInCookie } from "@/server/auth/testing";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const { default: TeamsRoute } = await import("./page");

function withCookie(cookie: string): void {
  vi.mocked(headers).mockResolvedValue(new Headers({ cookie }));
}

async function canManageFor(role: "viewer" | "member" | "manager" | "admin"): Promise<unknown> {
  await createTestAccount({ role });
  withCookie(await signInCookie());
  const element = (await TeamsRoute()) as { props: { canManage?: unknown } };
  return element.props.canManage;
}

describe("the /teams page (WS-035)", () => {
  beforeEach(() => {
    vi.mocked(headers).mockReset();
  });

  it.each(["viewer", "member"] as const)("renders read-only for a %s", async (role) => {
    expect(await canManageFor(role)).toBe(false);
  });

  it.each(["manager", "admin"] as const)(
    "renders with management controls for a %s",
    async (role) => {
      expect(await canManageFor(role)).toBe(true);
    },
  );

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
