// The `test` every specification uses (WS-041): a page that reports a Content Security
// Policy violation fails the test that caused it, so no later change can quietly break the
// policy. `security-headers.spec.ts` uses Playwright's own `test`, because it causes one on
// purpose.
import { expect, test as playwrightTest } from "@playwright/test";

const VIOLATION = /Content Security Policy|Refused to (?:execute|load|apply|connect|frame)/i;

export const test = playwrightTest.extend({
  page: async ({ page }, provide) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (VIOLATION.test(message.text())) violations.push(message.text());
    });

    await provide(page);

    expect(violations, "the browser reported a Content Security Policy violation").toEqual([]);
  },
});

export { expect };
