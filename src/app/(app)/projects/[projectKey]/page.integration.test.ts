import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestAccount, signInCookie, testActor } from "@/server/auth/testing";
import { archiveProject, createProject } from "@/server/services/projects";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const { default: ProjectRoute } = await import("./page");

const params = (projectKey: string) => ({ params: Promise.resolve({ projectKey }) });

async function signedInAs(role: "viewer" | "member" | "manager" | "admin") {
  const account = await createTestAccount({ role });
  vi.mocked(headers).mockResolvedValue(new Headers({ cookie: await signInCookie() }));
  return account;
}

interface Element {
  props: { project?: { key?: string; name?: string }; canManage?: unknown };
}

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
    expect(element.props.canWrite).toBe(true);
  });

  it.each([
    ["member", true],
    ["viewer", false],
  ] as const)("lets a %s write on the board: %s", async (role, canWrite) => {
    const manager = await createTestAccount({ email: "m@example.com", role: "manager" });
    await createProject(testActor(manager), { key: "OPA", name: "Opanel" });
    await signedInAs(role);

    const element = (await ProjectRoute(params("OPA"))) as Element;

    expect(element.props.canWrite).toBe(canWrite);
  });

  it("passes an archived project on, so the board is read-only", async () => {
    const manager = await signedInAs("manager");
    const actor = testActor(manager);
    await createProject(actor, { key: "OPA", name: "Opanel" });
    await archiveProject(actor, "OPA");

    const element = (await ProjectRoute(params("OPA"))) as Element;

    expect(element.props.project?.archivedAt).not.toBeNull();
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
