import { readFileSync } from "node:fs";
import path from "node:path";

import { cookies, headers } from "next/headers";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestAccount, signInCookie } from "@/server/auth/testing";

vi.mock("next/headers", () => ({ headers: vi.fn(), cookies: vi.fn() }));

const { default: AppLayout } = await import("./layout");

function request(cookie: string | undefined): void {
  vi.mocked(headers).mockResolvedValue(new Headers(cookie === undefined ? {} : { cookie }));
  vi.mocked(cookies).mockResolvedValue({
    get: () => undefined,
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

describe("the (app) layout", () => {
  beforeEach(() => {
    vi.mocked(headers).mockReset();
    vi.mocked(cookies).mockReset();
  });

  it("calls requireAccount(): the check that protects every page under (app)", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/(app)/layout.tsx"), "utf8");

    expect(source).toContain("requireAccount(");
  });

  it("redirects to /sign-in when there is no valid session", async () => {
    request(undefined);

    let digest = "";
    try {
      await AppLayout({ children: null });
    } catch (error) {
      digest = (error as { digest?: string }).digest ?? "";
    }

    expect(digest).toContain("NEXT_REDIRECT;replace;/sign-in;");
  });

  it("renders the shell for a valid session", async () => {
    await createTestAccount();
    request(await signInCookie());

    expect(await AppLayout({ children: null })).toBeTruthy();
  });

  it.each([
    ["admin", true],
    ["manager", false],
    ["member", false],
    ["viewer", false],
  ] as const)("tells the shell whether a %s can manage accounts: %s", async (role, expected) => {
    await createTestAccount({ role });
    request(await signInCookie());

    const shell = (await AppLayout({ children: null })) as ReactElement<{
      canManageAccounts?: boolean;
    }>;

    expect(shell.props.canManageAccounts).toBe(expected);
  });
});
