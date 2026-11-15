import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestAccount, signInCookie, testActor } from "@/server/auth/testing";
import { createProject } from "@/server/services/projects";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const { default: SettingsRoute } = await import("./page");

const params = (projectKey: string) => ({ params: Promise.resolve({ projectKey }) });

async function signedInAs(role: "viewer" | "member" | "manager" | "admin") {
  const account = await createTestAccount({ email: `${role}@example.com`, role });
  vi.mocked(headers).mockResolvedValue(new Headers({ cookie: await signInCookie(account.email) }));
}

async function seedProject() {
  const manager = await createTestAccount({ email: "owner@example.com", role: "manager" });
  await createProject(testActor(manager), { key: "OPA", name: "Opanel" });
}

describe("the /projects/[projectKey]/settings page (WS-036)", () => {
  beforeEach(() => {
    vi.mocked(headers).mockReset();
  });

  it.each(["manager", "admin"] as const)("renders for a %s", async (role) => {
    await seedProject();
    await signedInAs(role);

    const element = (await SettingsRoute(params("OPA"))) as {
      props: { project?: { key?: string } };
    };

    expect(element.props.project?.key).toBe("OPA");
  });

  it.each(["member", "viewer"] as const)("is a not-found page for a %s", async (role) => {
    await seedProject();
    await signedInAs(role);

    await expect(SettingsRoute(params("OPA"))).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  });

  it("is a not-found page for an unknown key", async () => {
    await signedInAs("manager");

    await expect(SettingsRoute(params("NOPE"))).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  });

  it("redirects to /sign-in without a session", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers());
    let digest = "";
    try {
      await SettingsRoute(params("OPA"));
    } catch (error) {
      digest = (error as { digest?: string }).digest ?? "";
    }

    expect(digest).toContain("NEXT_REDIRECT;replace;/sign-in;");
  });
});
