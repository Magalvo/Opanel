import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestAccount, signInCookie, testActor } from "@/server/auth/testing";
import { createProject } from "@/server/services/projects";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const { default: ProjectRoute } = await import("./page");

const params = (projectKey: string) => ({ params: Promise.resolve({ projectKey }) });

async function signedInAs(role: "viewer" | "member" | "manager" | "admin") {
  const account = await createTestAccount({ role });
  vi.mocked(headers).mockResolvedValue(new Headers({ cookie: await signInCookie() }));
  return account;
}

type Element = { props: { project?: { key?: string; name?: string }; canManage?: unknown } };

describe("the /projects/[projectKey] page (WS-036)", () => {
  beforeEach(() => {
    vi.mocked(headers).mockReset();
  });

  it("renders the project, with Settings offered only to a Manager or Admin", async () => {
    const manager = await signedInAs("manager");
    await createProject(testActor(manager), { key: "OPA", name: "Opanel" });

    const element = (await ProjectRoute(params("OPA"))) as Element;

    expect(element.props.project).toMatchObject({ key: "OPA", name: "Opanel" });
    expect(element.props.canManage).toBe(true);
  });

  it("renders read-only for a Member", async () => {
    const manager = await createTestAccount({ email: "m@example.com", role: "manager" });
    await createProject(testActor(manager), { key: "OPA", name: "Opanel" });
    await signedInAs("member");

    const element = (await ProjectRoute(params("OPA"))) as Element;

    expect(element.props.canManage).toBe(false);
  });

  it("is a not-found page for an unknown key", async () => {
    await signedInAs("manager");

    await expect(ProjectRoute(params("NOPE"))).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  });

  it("redirects to /sign-in without a session", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers());
    let digest = "";
    try {
      await ProjectRoute(params("OPA"));
    } catch (error) {
      digest = (error as { digest?: string }).digest ?? "";
    }

    expect(digest).toContain("NEXT_REDIRECT;replace;/sign-in;");
  });
});
