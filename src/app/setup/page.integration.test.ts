import { describe, expect, it, vi } from "vitest";

import { createTestAccount } from "@/server/auth/testing";
import type * as Env from "@/server/env";

import SetupPage from "./page";

// The configured setup token (WS-050), changed per test; unset unless a test sets it.
const configured = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("@/server/env", async (importOriginal) => {
  const actual = await importOriginal<typeof Env>();
  return { ...actual, getEnv: () => ({ ...actual.getEnv(), SETUP_TOKEN: configured.token }) };
});

/** The props the page gives the setup form, found in the rendered element tree. */
function formProps(element: unknown): { tokenRequired?: unknown } | undefined {
  if (element === null || typeof element !== "object" || !("props" in element)) return undefined;
  const { type, props } = element as { type: unknown; props: Record<string, unknown> };
  if (typeof type === "function" && type.name === "SetupForm") return props;
  const children = props.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = formProps(child);
    if (found) return found;
  }
  return undefined;
}

describe("the /setup page", () => {
  it("renders on an empty install", async () => {
    expect(await SetupPage()).toBeTruthy();
  });

  it("is a not-found page as soon as an account exists", async () => {
    await createTestAccount();

    await expect(SetupPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("asks the form for a setup token only when one is configured (WS-050)", async () => {
    expect(formProps(await SetupPage())?.tokenRequired).toBe(false);

    configured.token = "Configured-Token-7c41-0123456789";
    try {
      expect(formProps(await SetupPage())?.tokenRequired).toBe(true);
    } finally {
      configured.token = undefined;
    }
  });
});
