// Every spec imports `test` and `expect` from here (or from ./fixtures, which builds on
// it) instead of from Playwright: a test fails if its page reports any Content Security
// Policy violation (WS-041, test 9), so a page that breaks the policy is caught by the
// work-item that introduces it.
import { expect, test as playwrightTest } from "@playwright/test";

interface CspOptions {
  /** Set with `test.use` by the one test that injects a script on purpose. */
  allowCspViolations: boolean;
}

interface CspGuard {
  cspGuard: undefined;
}

export const test = playwrightTest.extend<CspOptions & CspGuard>({
  allowCspViolations: [false, { option: true }],
  cspGuard: [
    async ({ page, allowCspViolations }, provide) => {
      const violations: string[] = [];
      page.on("console", (message) => {
        if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
      });
      await provide(undefined);
      if (!allowCspViolations) {
        expect(violations, "Content Security Policy violations").toEqual([]);
      }
    },
    { auto: true },
  ],
});

export { expect };
