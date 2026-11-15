import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestAccount, signInCookie, testActor } from "@/server/auth/testing";
import { archiveProject, createProject } from "@/server/services/projects";
import { createTask, deleteTask } from "@/server/services/tasks";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const { default: TaskRoute } = await import("./page");

const params = (projectKey: string, taskKey: string) => ({
  params: Promise.resolve({ projectKey, taskKey }),
});

interface Element {
  props: {
    task?: { key?: string };
    archived?: unknown;
    canWrite?: unknown;
    canDelete?: unknown;
    canComment?: unknown;
  };
}

async function seed() {
  const manager = await createTestAccount({ email: "manager@example.com", role: "manager" });
  const reporter = await createTestAccount({ email: "reporter@example.com", role: "member" });
  await createTestAccount({ email: "other@example.com", role: "member" });
  await createTestAccount({ email: "viewer@example.com", role: "viewer" });
  const owner = testActor(manager);
  await createProject(owner, { key: "OPA", name: "Opanel" });
  await createProject(owner, { key: "OTH", name: "Other" });
  await createTask(testActor(reporter), "OPA", { title: "Fix login" });
  return owner;
}

async function signedInAs(email: string) {
  vi.mocked(headers).mockResolvedValue(new Headers({ cookie: await signInCookie(email) }));
}

async function render(email: string, projectKey = "OPA", taskKey = "OPA-1") {
  await signedInAs(email);
  return (await TaskRoute(params(projectKey, taskKey))) as Element;
}

describe("the task page (WS-038), dialog page", () => {
  beforeEach(() => {
    vi.mocked(headers).mockReset();
  });

  it("gives a Manager every right, and passes the task", async () => {
    await seed();

    const element = await render("manager@example.com");

    expect(element.props.task?.key).toBe("OPA-1");
    expect(element.props).toMatchObject({
      archived: false,
      canWrite: true,
      canDelete: true,
      canComment: true,
    });
  });

  it("lets the reporter delete, and another Member write and comment but not delete", async () => {
    await seed();

    expect((await render("reporter@example.com")).props).toMatchObject({
      canDelete: true,
      canWrite: true,
    });
    expect((await render("other@example.com")).props).toMatchObject({
      canDelete: false,
      canWrite: true,
      canComment: true,
    });
  });

  it("lets a Viewer read and nothing else", async () => {
    await seed();

    expect((await render("viewer@example.com")).props).toMatchObject({
      canWrite: false,
      canDelete: false,
      canComment: false,
    });
  });

  it("passes an archived project on", async () => {
    const owner = await seed();
    await archiveProject(owner, "OPA");

    expect((await render("manager@example.com")).props.archived).toBe(true);
  });

  it("is a not-found page for another project's key, an unknown task and a deleted task", async () => {
    const owner = await seed();
    await signedInAs("manager@example.com");

    for (const [project, task] of [
      ["OTH", "OPA-1"],
      ["OPA", "OPA-9"],
      ["NOPE", "OPA-1"],
      ["OPA", "not a key"],
    ] as const) {
      await expect(TaskRoute(params(project, task))).rejects.toMatchObject({
        digest: "NEXT_HTTP_ERROR_FALLBACK;404",
      });
    }
    await deleteTask(owner, "OPA-1");
    await expect(TaskRoute(params("OPA", "OPA-1"))).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  });

  it("redirects to /sign-in without a session", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers());
    let digest = "";
    try {
      await TaskRoute(params("OPA", "OPA-1"));
    } catch (error) {
      digest = (error as { digest?: string }).digest ?? "";
    }

    expect(digest).toContain("NEXT_REDIRECT;replace;/sign-in;");
  });
});
