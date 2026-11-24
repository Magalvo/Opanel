import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./base";
import { E2E_BASE_URL } from "./environment";
import { seedAccount, seedAgent, seedAgentWork } from "./seed";

const password = "an e2e agent badge password, long";
const headers = { Origin: E2E_BASE_URL };

for (const colorScheme of ["light", "dark"] as const) {
  test(`an agent's task and comment carry the Agent badge, accessibly, in ${colorScheme} mode (WS-074)`, async ({
    page,
  }) => {
    const id = crypto.randomUUID().slice(0, 8);
    const email = `agent-badge-${id}@example.com`;
    await seedAccount({ email, password, role: "manager", name: `Manager ${id}` });
    expect(
      (
        await page.request.post("/api/v1/auth/sign-in", { headers, data: { email, password } })
      ).status(),
    ).toBe(200);
    const key = `B${id.replace(/-/g, "").slice(0, 7).toUpperCase()}`;
    expect(
      (
        await page.request.post("/api/v1/projects", {
          headers,
          data: { key, name: `Badge ${key}` },
        })
      ).status(),
    ).toBe(201);
    const botName = `QA Bot ${id}`;
    const agentId = await seedAgent(botName);
    const taskKey = await seedAgentWork({
      agentId,
      projectKey: key,
      title: "Found by the bot",
      comment: "Steps to reproduce",
    });
    expect(
      (
        await page.request.post(`/api/v1/tasks/${taskKey}/comments`, {
          headers,
          data: { body: "Thanks, looking" },
        })
      ).status(),
    ).toBe(201);
    await page.emulateMedia({ colorScheme });

    await page.goto(`/projects/${key}`);
    await page.getByRole("link", { name: "Found by the bot" }).click();
    const dialog = page.getByRole("dialog");
    const comments = dialog.getByRole("region", { name: "Activity" });
    await expect(comments.getByRole("article")).toHaveCount(2);

    const details = dialog.getByRole("region", { name: "Details" });
    await expect(
      details.getByText("Reporter").locator("xpath=following-sibling::dd[1]"),
    ).toHaveText(new RegExp(`^${botName}\s*Agent$`));
    await expect(comments.getByRole("article").nth(0)).toContainText(`${botName}Agent`);
    await expect(comments.getByRole("article").nth(1)).toContainText(`Manager ${id}`);
    await expect(comments.getByRole("article").nth(1).getByText("Agent")).toHaveCount(0);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
}
