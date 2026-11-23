import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestAccount, signInCookie } from "@/server/auth/testing";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const { default: TaskRoute } = await import("./page");
const { default: TaskDialogRoute } = await import("../../@modal/(.)tasks/[taskKey]/page");

function withCookie(cookie: string): void {
  vi.mocked(headers).mockResolvedValue(new Headers({ cookie }));
}

function args(projectKey: string, taskKey: string) {
  return { params: Promise.resolve({ projectKey, taskKey }) };
}

const RIGHTS = {
  admin: {
    canWriteTasks: true,
    canWriteLabels: true,
    canComment: true,
    canDeleteAny: true,
    canDeleteOwn: true,
  },
  manager: {
    canWriteTasks: true,
    canWriteLabels: true,
    canComment: true,
    canDeleteAny: true,
    canDeleteOwn: true,
  },
  member: {
    canWriteTasks: true,
    canWriteLabels: true,
    canComment: true,
    canDeleteAny: false,
    canDeleteOwn: true,
  },
  viewer: {
    canWriteTasks: false,
    canWriteLabels: false,
    canComment: false,
    canDeleteAny: false,
    canDeleteOwn: false,
  },
} as const;

describe("the task pages (WS-038)", () => {
  beforeEach(() => {
    vi.mocked(headers).mockReset();
  });

  it.each(["admin", "manager", "member", "viewer"] as const)(
    "give a %s the task with the right rights, as a page and as a dialog",
    async (role) => {
      const account = await createTestAccount({ role });
      withCookie(await signInCookie());

      const page = await TaskRoute(args("OPA", "OPA-12"));
      expect(page.props).toEqual({
        taskKey: "OPA-12",
        mode: "page",
        accountId: account.id,
        ...RIGHTS[role],
      });

      const dialog = await TaskDialogRoute(args("OPA", "OPA-12"));
      expect(dialog.props).toMatchObject({ taskKey: "OPA-12" });
      expect((dialog.props as { children: { props: unknown } }).children.props).toEqual({
        taskKey: "OPA-12",
        mode: "dialog",
        accountId: account.id,
        ...RIGHTS[role],
      });
    },
  );

  it("are not-found for a segment that is not a task key, or a key of another project", async () => {
    await createTestAccount({ role: "member" });
    withCookie(await signInCookie());

    for (const taskKey of ["opa-1", "OPA", "OPA-0", "OPA-x", "XYZ-1", "OPAB-1"]) {
      await expect(TaskRoute(args("OPA", taskKey)), taskKey).rejects.toMatchObject({
        digest: "NEXT_HTTP_ERROR_FALLBACK;404",
      });
      await expect(TaskDialogRoute(args("OPA", taskKey)), taskKey).rejects.toMatchObject({
        digest: "NEXT_HTTP_ERROR_FALLBACK;404",
      });
    }
  });

  it("redirect to /sign-in without a session", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers());

    for (const route of [TaskRoute, TaskDialogRoute]) {
      await expect(route(args("OPA", "OPA-1"))).rejects.toMatchObject({
        digest: expect.stringContaining("NEXT_REDIRECT;replace;/sign-in;") as unknown,
      });
    }
  });
});
