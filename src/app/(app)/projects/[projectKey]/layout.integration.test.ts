import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestAccount, signInCookie } from "@/server/auth/testing";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const { default: ProjectLayout } = await import("./layout");
const { default: BoardRoute } = await import("./page");

function withCookie(cookie: string): void {
  vi.mocked(headers).mockResolvedValue(new Headers({ cookie }));
}

function args(projectKey: string) {
  return { children: "the page", params: Promise.resolve({ projectKey }) };
}

describe("the /projects/KEY layout and board page", () => {
  beforeEach(() => {
    vi.mocked(headers).mockReset();
  });

  it.each([
    ["admin", true],
    ["manager", true],
    ["member", false],
    ["viewer", false],
  ] as const)("frames the project for a %s, with canManageProjects %s", async (role, canManage) => {
    await createTestAccount({ role });
    withCookie(await signInCookie());

    const layout = await ProjectLayout(args("OPA"));

    expect(layout.props).toEqual({
      projectKey: "OPA",
      canManageProjects: canManage,
      children: "the page",
    });
  });

  it("is a not-found page for a segment that is not a project key", async () => {
    await createTestAccount({ role: "manager" });
    withCookie(await signInCookie());

    for (const segment of ["opa", "O", "1PA", "TOOLONGKEY1"]) {
      await expect(ProjectLayout(args(segment))).rejects.toMatchObject({
        digest: "NEXT_HTTP_ERROR_FALLBACK;404",
      });
    }
  });

  it("redirects to /sign-in without a session", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers());
    let digest = "";
    try {
      await ProjectLayout(args("OPA"));
    } catch (error) {
      digest = (error as { digest?: string }).digest ?? "";
    }

    expect(digest).toContain("NEXT_REDIRECT;replace;/sign-in;");
  });

  it("has a board page that renders", () => {
    expect(BoardRoute()).toBeTruthy();
  });
});
