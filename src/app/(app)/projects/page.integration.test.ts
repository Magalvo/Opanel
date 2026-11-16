import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestAccount, signInCookie } from "@/server/auth/testing";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const { default: ProjectsRoute } = await import("./page");

function withCookie(cookie: string): void {
  vi.mocked(headers).mockResolvedValue(new Headers({ cookie }));
}

function query(view?: string) {
  return { searchParams: Promise.resolve(view === undefined ? {} : { view }) };
}

describe("the /projects page", () => {
  beforeEach(() => {
    vi.mocked(headers).mockReset();
  });

  it.each([
    ["admin", true],
    ["manager", true],
    ["member", false],
    ["viewer", false],
  ] as const)("renders for a %s, with canManageProjects %s", async (role, canManage) => {
    await createTestAccount({ role });
    withCookie(await signInCookie());

    const page = await ProjectsRoute(query());

    expect(page.props).toEqual({ view: "active", canManageProjects: canManage });
  });

  it("shows the archived view only for ?view=archived", async () => {
    await createTestAccount({ role: "viewer" });
    withCookie(await signInCookie());

    expect((await ProjectsRoute(query("archived"))).props).toMatchObject({ view: "archived" });
    expect((await ProjectsRoute(query("other"))).props).toMatchObject({ view: "active" });
  });

  it("redirects to /sign-in without a session", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers());
    let digest = "";
    try {
      await ProjectsRoute(query());
    } catch (error) {
      digest = (error as { digest?: string }).digest ?? "";
    }

    expect(digest).toContain("NEXT_REDIRECT;replace;/sign-in;");
  });
});
