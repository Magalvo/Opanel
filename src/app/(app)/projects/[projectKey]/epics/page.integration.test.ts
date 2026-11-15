import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestAccount, signInCookie, testActor } from "@/server/auth/testing";
import { archiveProject, createProject } from "@/server/services/projects";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const { default: EpicsRoute } = await import("./page");

const params = (projectKey: string) => ({ params: Promise.resolve({ projectKey }) });

interface Element {
  props: { project?: { key?: string }; canManage?: unknown; archived?: unknown };
}

async function seed() {
  const manager = await createTestAccount({ email: "manager@example.com", role: "manager" });
  await createTestAccount({ email: "admin@example.com", role: "admin" });
  await createTestAccount({ email: "member@example.com", role: "member" });
  await createTestAccount({ email: "viewer@example.com", role: "viewer" });
  const owner = testActor(manager);
  await createProject(owner, { key: "OPA", name: "Opanel" });
  return owner;
}

async function render(email: string, key = "OPA") {
  vi.mocked(headers).mockResolvedValue(new Headers({ cookie: await signInCookie(email) }));
  return (await EpicsRoute(params(key))) as Element;
}

describe("the /projects/[projectKey]/epics page (WS-039)", () => {
  beforeEach(() => {
    vi.mocked(headers).mockReset();
  });

  it.each([
    ["manager@example.com", true],
    ["admin@example.com", true],
    ["member@example.com", false],
    ["viewer@example.com", false],
  ] as const)("renders for %s with canManage %s", async (email, canManage) => {
    await seed();

    const element = await render(email);

    expect(element.props.project?.key).toBe("OPA");
    expect(element.props.canManage).toBe(canManage);
    expect(element.props.archived).toBe(false);
  });

  it("passes an archived project on, so the page is read-only", async () => {
    const owner = await seed();
    await archiveProject(owner, "OPA");

    expect((await render("manager@example.com")).props.archived).toBe(true);
  });

  it("is a not-found page for an unknown or malformed project key", async () => {
    await seed();
    vi.mocked(headers).mockResolvedValue(
      new Headers({ cookie: await signInCookie("manager@example.com") }),
    );

    for (const key of ["NOPE", "bad key"]) {
      await expect(EpicsRoute(params(key))).rejects.toMatchObject({
        digest: "NEXT_HTTP_ERROR_FALLBACK;404",
      });
    }
  });

  it("redirects to /sign-in without a session", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers());
    let digest = "";
    try {
      await EpicsRoute(params("OPA"));
    } catch (error) {
      digest = (error as { digest?: string }).digest ?? "";
    }

    expect(digest).toContain("NEXT_REDIRECT;replace;/sign-in;");
  });
});
