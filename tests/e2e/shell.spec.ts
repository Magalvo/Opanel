import { expect, type Page, test } from "@playwright/test";

const html = (page: Page) => page.locator("html");
const sidebar = (page: Page) => page.locator('[data-slot="sidebar"][data-state]');

async function chooseTheme(page: Page, name: "Light" | "Dark" | "System"): Promise<void> {
  await page.getByRole("button", { name: "Theme" }).click();
  await page.getByRole("menuitemradio", { name }).click();
}

test.describe("theme", () => {
  test("follows a dark system setting", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");

    await expect(html(page)).toHaveClass(/\bdark\b/);
  });

  test("follows a light system setting", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");

    await expect(html(page)).not.toHaveClass(/\bdark\b/);
  });

  test("an explicit choice overrides the system and survives a reload", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");

    await chooseTheme(page, "Dark");
    await expect(html(page)).toHaveClass(/\bdark\b/);

    await page.reload();
    await expect(html(page)).toHaveClass(/\bdark\b/);

    await chooseTheme(page, "System");
    await expect(html(page)).not.toHaveClass(/\bdark\b/);
  });
});

test.describe("sidebar", () => {
  test("collapses and expands, and remembers its state across a reload", async ({ page }) => {
    await page.goto("/");
    await expect(sidebar(page)).toHaveAttribute("data-state", "expanded");

    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await expect(sidebar(page)).toHaveAttribute("data-state", "collapsed");

    await page.reload();
    await expect(sidebar(page)).toHaveAttribute("data-state", "collapsed");

    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await expect(sidebar(page)).toHaveAttribute("data-state", "expanded");
  });

  test("is an overlay on a phone-sized screen, without horizontal scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: "Opanel" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "Toggle sidebar" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("navigation", { name: "Main" })).toBeVisible();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});

test("uses the compact density", async ({ page }) => {
  await page.goto("/");

  const rootFontSize = await page.evaluate(
    () => getComputedStyle(document.documentElement).fontSize,
  );
  expect(rootFontSize).toBe("14px");
});
