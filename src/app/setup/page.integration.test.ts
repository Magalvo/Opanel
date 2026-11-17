import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestAccount } from "@/server/auth/testing";
import type * as Env from "@/server/env";

import SetupPage from "./page";

// The configured setup token (WS-050) and mode (WS-055), changed per test; unset and the
// test runner's own mode unless a test sets them.
const configured = vi.hoisted(() => ({
  token: undefined as string | undefined,
  nodeEnv: undefined as "development" | "test" | "production" | undefined,
}));
vi.mock("@/server/env", async (importOriginal) => {
  const actual = await importOriginal<typeof Env>();
  return {
    ...actual,
    getEnv: () => {
      const env = actual.getEnv();
      return {
        ...env,
        SETUP_TOKEN: configured.token,
        NODE_ENV: configured.nodeEnv ?? env.NODE_ENV,
      };
    },
  };
});

/** Every text in the rendered element tree, joined. */
function textOf(element: unknown): string {
  if (typeof element === "string" || typeof element === "number") return String(element);
  if (Array.isArray(element)) return element.map(textOf).join("");
  if (element === null || typeof element !== "object" || !("props" in element)) return "";
  return textOf((element as { props: { children?: unknown } }).props.children);
}

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

  describe("in production (WS-055)", () => {
    afterEach(() => {
      configured.nodeEnv = undefined;
      configured.token = undefined;
    });

    it("shows no form and explains SETUP_TOKEN when no token is configured", async () => {
      configured.nodeEnv = "production";

      const page = await SetupPage();

      expect(formProps(page)).toBeUndefined();
      expect(textOf(page)).toContain("SETUP_TOKEN");
      expect(textOf(page)).toContain(".env.example");
    });

    it("shows the form with the token field when a token is configured", async () => {
      configured.nodeEnv = "production";
      configured.token = "Configured-Token-7c41-0123456789";

      expect(formProps(await SetupPage())?.tokenRequired).toBe(true);
    });

    it("is a not-found page once an account exists, locked or not", async () => {
      configured.nodeEnv = "production";
      await createTestAccount();

      await expect(SetupPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    });
  });
});
