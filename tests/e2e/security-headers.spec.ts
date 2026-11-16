import type { APIResponse, Page } from "@playwright/test";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount } from "./seed";

/** The nonce of a policy's `script-src`. */
function nonceOf(policy: string | undefined): string | null {
  return /'nonce-([^']+)'/.exec(policy ?? "")?.[1] ?? null;
}

async function signIn(page: Page): Promise<void> {
  const email = `csp-${crypto.randomUUID()}@example.com`;
  const password = "an e2e security headers password";
  await seedAccount({ email, password, role: "member" });
  const response = await page.request.post("/api/v1/auth/sign-in", {
    headers: { Origin: E2E_BASE_URL },
    data: { email, password },
  });
  expect(response.status()).toBe(200);
}

function expectStaticHeaders(response: APIResponse, path: string): void {
  const headers = response.headers();
  expect(headers["x-content-type-options"], path).toBe("nosniff");
  expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
}

test("every response has nosniff and the referrer policy; pages also have the policy", async ({
  page,
}) => {
  await signIn(page);

  for (const path of ["/", "/sign-in", "/accept"]) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBeLessThan(500);
    expectStaticHeaders(response, path);
    const headers = response.headers();
    expect(nonceOf(headers["content-security-policy"]), path).not.toBeNull();
    expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"], path).toBe("DENY");
  }

  const api = await page.request.get("/api/v1/health");
  expectStaticHeaders(api, "/api/v1/health");
  expect(api.headers()["content-security-policy"]).toBeUndefined();
});

test("the page's scripts carry the nonce of its policy, which changes on every load", async ({
  page,
}) => {
  const nonces: string[] = [];
  for (let load = 0; load < 2; load += 1) {
    const response = await page.goto("/sign-in");
    const nonce = nonceOf(response?.headers()["content-security-policy"]);
    expect(nonce).not.toBeNull();
    const scripts = await page.evaluate(() =>
      [...document.querySelectorAll("script")].map((script) => script.nonce),
    );
    expect(scripts.length).toBeGreaterThan(0);
    expect(new Set(scripts)).toEqual(new Set([nonce]));
    nonces.push(nonce ?? "");
  }

  expect(nonces[0]).not.toBe(nonces[1]);
});

test.describe("an injected script", () => {
  // This test breaks the policy on purpose.
  test.use({ allowCspViolations: true });

  test("does not run without the nonce, and the browser reports the violation", async ({
    page,
  }) => {
    await page.goto("/sign-in");

    const outcome = await page.evaluate(
      () =>
        new Promise<{ ran: boolean; directive: string }>((resolve) => {
          document.addEventListener("securitypolicyviolation", (event) => {
            resolve({
              ran: (window as unknown as { injected?: boolean }).injected === true,
              directive: event.effectiveDirective,
            });
          });
          // Without a policy nothing is reported: answer what happened after a moment.
          setTimeout(() => {
            resolve({
              ran: (window as unknown as { injected?: boolean }).injected === true,
              directive: "",
            });
          }, 2000);
          const script = document.createElement("script");
          script.textContent = "window.injected = true;";
          document.body.append(script);
        }),
    );

    expect(outcome).toEqual({ ran: false, directive: "script-src-elem" });
  });
});
