import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestAccount, signInCookie } from "@/server/auth/testing";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const { default: ProjectsRoute } = await import("./page");

async function canManageFor(role: "viewer" | "member" | "manager" | "admin"): Promise<unknown> {
  await createTestAccount({ role });
  vi.mocked(headers).mockResolvedValue(new Headers({ cookie: await signInCookie() }));
  const element = (await ProjectsRoute()) as { props: { canManage?: unknown } };
  return element.props.canManage;
}

describe("the /projects page (WS-036)", () => {
  beforeEach(() => {
    vi.mocked(headers).mockReset();
  });

  it.each(["viewer", "member"] as const)("renders read-only for a %s", async (role) => {
    expect(await canManageFor(role)).toBe(false);
  });

  it.each(["manager", "admin"] as const)("offers New project to a %s", async (role) => {
    expect(await canManageFor(role)).toBe(true);
  });

  it("redirects to /sign-in without a session", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers());
    let digest = "";
    try {
      await ProjectsRoute();
    } catch (error) {
      digest = (error as { digest?: string }).digest ?? "";
    }

    expect(digest).toContain("NEXT_REDIRECT;replace;/sign-in;");
  });
});
