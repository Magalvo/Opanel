import { expect, test } from "@playwright/test";

import { meResponseSchema } from "@/lib/schemas/auth";
import { problemSchema } from "@/lib/schemas/problem";

import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

const password = "an e2e password, long enough";

test.describe("sign-in and sign-out", () => {
  test("signing in, asking who I am, signing out and asking again", async ({ request }) => {
    const email = `e2e-${crypto.randomUUID()}@example.com`;
    await seedAccount({ email, password, role: "manager" });
    const origin = { Origin: E2E_BASE_URL };

    expect((await request.get("/api/v1/me")).status()).toBe(401);

    const signIn = await request.post("/api/v1/auth/sign-in", {
      headers: origin,
      data: { email, password },
    });
    expect(signIn.status()).toBe(200);
    expect(signIn.headers()["set-cookie"]).toMatch(/HttpOnly/i);

    const me = await request.get("/api/v1/me");
    expect(me.status()).toBe(200);
    expect(meResponseSchema.parse(await me.json())).toMatchObject({ email, role: "manager" });

    const signOut = await request.post("/api/v1/auth/sign-out", { headers: origin });
    expect(signOut.status()).toBe(204);

    expect((await request.get("/api/v1/me")).status()).toBe(401);
  });

  test("a wrong password is a 401 problem body, and a foreign Origin is a 403", async ({
    request,
  }) => {
    const wrong = await request.post("/api/v1/auth/sign-in", {
      headers: { Origin: E2E_BASE_URL },
      data: { email: "nobody@example.com", password: "whatever" },
    });
    expect(wrong.status()).toBe(401);
    expect(problemSchema.parse(await wrong.json()).code).toBe("unauthenticated");

    const foreign = await request.post("/api/v1/auth/sign-in", {
      headers: { Origin: "https://evil.example" },
      data: { email: "nobody@example.com", password: "whatever" },
    });
    expect(foreign.status()).toBe(403);
  });
});
