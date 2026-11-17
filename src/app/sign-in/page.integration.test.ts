import { headers } from "next/headers";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestAccount, signInCookie } from "@/server/auth/testing";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const { default: SignInPage } = await import("./page");

function withCookie(cookie: string | undefined): void {
  vi.mocked(headers).mockResolvedValue(new Headers(cookie === undefined ? {} : { cookie }));
}

function props(next?: string | string[], notice?: string) {
  return {
    searchParams: Promise.resolve({
      ...(next === undefined ? {} : { next }),
      ...(notice === undefined ? {} : { notice }),
    }),
  };
}

/** Every text in the rendered element tree, joined. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return (node as ReactNode[]).map(textOf).join("");
  if (typeof node !== "object" || node === null || !("props" in node)) return "";
  return textOf((node as ReactElement<{ children?: ReactNode }>).props.children);
}

async function redirectTarget(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    return digest.startsWith("NEXT_REDIRECT;") ? (digest.split(";")[2] ?? null) : null;
  }
  return null;
}

/** The `next` prop of the first element in the tree that has one. */
function findNext(node: ReactNode): unknown {
  if (typeof node !== "object" || node === null || !("props" in node)) return undefined;
  const element = node as ReactElement<{ next?: unknown; children?: ReactNode }>;
  if (element.props.next !== undefined) return element.props.next;
  const children = Array.isArray(element.props.children)
    ? (element.props.children as ReactNode[])
    : [element.props.children];
  for (const child of children) {
    const found = findNext(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

describe("the /sign-in page", () => {
  beforeEach(() => {
    vi.mocked(headers).mockReset();
    withCookie(undefined);
  });

  it("sends a visitor of an empty install to /setup", async () => {
    expect(await redirectTarget(SignInPage(props()))).toBe("/setup");
  });

  it("sends a person who is already signed in to /", async () => {
    await createTestAccount();
    withCookie(await signInCookie());

    expect(await redirectTarget(SignInPage(props()))).toBe("/");
  });

  it("renders for a visitor who is not signed in, with a sanitised return path", async () => {
    await createTestAccount();

    expect(findNext(await SignInPage(props("/projects/1")))).toBe("/projects/1");
    expect(findNext(await SignInPage(props("//evil.com")))).toBe("/");
    expect(findNext(await SignInPage(props(["/a", "/b"])))).toBe("/");
    expect(findNext(await SignInPage(props()))).toBe("/");
  });

  it("shows the notice of a known value and nothing for another (WS-057)", async () => {
    await createTestAccount();

    expect(textOf(await SignInPage(props(undefined, "password-set")))).toContain(
      "Your password is set. Sign in with it.",
    );
    expect(textOf(await SignInPage(props(undefined, "admin-created")))).toContain(
      "The administrator was created. Sign in with your password.",
    );
    const other = textOf(await SignInPage(props(undefined, "Injected-Text-77")));
    expect(other).not.toContain("Injected-Text-77");
    expect(other).not.toContain("Your password is set");
  });
});
