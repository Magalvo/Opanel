import { expect, test } from "./fixtures";

test("the home page shows the Opanel heading", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Opanel");
  await expect(page.getByRole("heading", { level: 1, name: "Opanel" })).toBeVisible();
});
