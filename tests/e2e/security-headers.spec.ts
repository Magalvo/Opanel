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

  test("a script that reaches the page's markup without the nonce does not run, and is reported", async ({
    page,
  }) => {
    // What an HTML injection produces: a script the parser meets, with no nonce. (A script made
    // by code that is already trusted is allowed by `'strict-dynamic'`, by design, so it is not
    // the case that matters.)
    const reports: string[] = [];
    page.on("console", (message) => {
      reports.push(message.text());
    });
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- reason: document.write is the one way to make a parser-inserted script, which is what an HTML injection is
      document.write("<script>window.injected = true;</script><p>after</p>");
      document.close();
    });

    await expect
      .poll(() => reports.some((text) => text.includes("Content Security Policy")))
      .toBe(true);
    expect(await page.evaluate(() => "injected" in window)).toBe(false);
  });

  test("the first paint follows a dark system setting, with the theme script allowed", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/sign-in");

    await expect(page.locator("html")).toHaveClass(/dark/);
  });
});
