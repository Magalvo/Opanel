import { readFileSync } from "node:fs";
import path from "node:path";

import { cookies, headers } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestAccount, signInCookie } from "@/server/auth/testing";

vi.mock("next/headers", () => ({ headers: vi.fn(), cookies: vi.fn() }));

const { default: AppLayout } = await import("./layout");

function request(cookie: string | undefined): void {
  vi.mocked(headers).mockResolvedValue(
    new Headers(cookie === undefined ? {} : { cookie }) as Awaited<ReturnType<typeof headers>>,
  );
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

    await expect(AppLayout({ children: null })).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT;replace;/sign-in;"),
    });
  });

  it("renders the shell for a valid session", async () => {
    await createTestAccount();
    request(await signInCookie());

    expect(await AppLayout({ children: null })).toBeTruthy();
  });
});
