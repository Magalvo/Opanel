import { expect, test } from "@playwright/test";

const PAGES = ["/sign-in", "/accept", "/"];

test.describe("security headers", () => {
  for (const path of [...PAGES, "/api/v1/health"]) {
    test(`${path} has nosniff and a referrer policy`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });

      expect(response.headers()["x-content-type-options"]).toBe("nosniff");
      expect(response.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    });
  }

  for (const path of PAGES) {
    test(`${path} has the policy and refuses to be framed`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      const policy = response.headers()["content-security-policy"] ?? "";

      expect(policy).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
      expect(policy).toContain("frame-ancestors 'none'");
      expect(policy).toContain("object-src 'none'");
      expect(policy).not.toContain("'unsafe-eval'");
      expect(response.headers()["x-frame-options"]).toBe("DENY");
    });
  }

  test("the API does not carry the policy, which is for pages", async ({ request }) => {
    const response = await request.get("/api/v1/health");

    expect(response.headers()["content-security-policy"]).toBeUndefined();
  });

  test("the nonce of the header is the nonce of the page's scripts, and changes per load", async ({
    request,
  }) => {
    const nonces: string[] = [];
    for (let load = 0; load < 2; load += 1) {
      const response = await request.get("/sign-in");
      const nonce = /'nonce-([^']+)'/.exec(
        response.headers()["content-security-policy"] ?? "",
      )?.[1];
      expect(nonce).toBeTruthy();
      const html = await response.text();
      expect(html).toContain(`nonce="${nonce ?? ""}"`);
      nonces.push(nonce ?? "");
    }

    expect(nonces[0]).not.toBe(nonces[1]);
  });

  test("a script added to the page without the nonce does not run, and is reported", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const outcome = await page.evaluate(
      () =>
        new Promise<{ ran: boolean; blocked: string | null }>((resolve) => {
          const win = window as unknown as { injected?: boolean };
          document.addEventListener("securitypolicyviolation", (event) => {
            resolve({ ran: win.injected === true, blocked: event.violatedDirective });
          });
          const script = document.createElement("script");
          script.textContent = "window.injected = true;";
          document.body.append(script);
          setTimeout(() => {
            resolve({ ran: win.injected === true, blocked: null });
          }, 2000);
        }),
    );

    expect(outcome.ran).toBe(false);
    expect(outcome.blocked).toMatch(/^script-src/);
  });

  test("the first paint follows a dark system setting, with the theme script allowed", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/sign-in");

    await expect(page.locator("html")).toHaveClass(/dark/);
  });
});
