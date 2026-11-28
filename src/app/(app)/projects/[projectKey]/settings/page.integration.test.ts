import { headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestAccount, signInCookie } from "@/server/auth/testing";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const { default: SettingsRoute } = await import("./page");

function withCookie(cookie: string): void {
  vi.mocked(headers).mockResolvedValue(new Headers({ cookie }));
}

describe("the /projects/KEY/settings page", () => {
  beforeEach(() => {
    vi.mocked(headers).mockReset();
  });

  it.each(["admin", "manager"] as const)(
    "renders for a %s, who may restore deleted tasks",
    async (role) => {
      await createTestAccount({ role });
      withCookie(await signInCookie());

      const page = await SettingsRoute();

      expect(page.props).toEqual({
        canRestoreTasks: true,
        canManageTriage: true,
        canManageSprints: true,
      });
    },
  );

  it.each(["member", "viewer"] as const)("is a not-found page for a %s", async (role) => {
    await createTestAccount({ role });
    withCookie(await signInCookie());

    await expect(SettingsRoute()).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  });
});
