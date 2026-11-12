import { describe, expect, it } from "vitest";

import { createTestAccount } from "@/server/auth/testing";

import SetupPage from "./page";

describe("the /setup page", () => {
  it("renders on an empty install", async () => {
    expect(await SetupPage()).toBeTruthy();
  });

  it("is a not-found page as soon as an account exists", async () => {
    await createTestAccount();

    await expect(SetupPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });
});
