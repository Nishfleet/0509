import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// #4148: /login is measured with Deque's axe-core at WCAG 2.2 AA on both of its
// states, in both themes, at both config widths. The form and the sent state are
// separate tests so a violation names which state it is in.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

for (const scheme of ["light", "dark"] as const) {
  test(`/login form has zero WCAG 2.2 AA violations in ${scheme} (#4148)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/login");

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    await test.info().attach(`axe-login-form-${scheme}`, {
      body: JSON.stringify(results.violations, null, 2),
      contentType: "application/json",
    });
    expect(results.violations).toEqual([]);
  });

  test(`/login sent state has zero WCAG 2.2 AA violations in ${scheme} (#4148)`, async ({ page }) => {
    await page.clock.install();
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/login");

    const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
    await page.locator('input[name="email"]').fill(email);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    await test.info().attach(`axe-login-sent-${scheme}`, {
      body: JSON.stringify(results.violations, null, 2),
      contentType: "application/json",
    });
    expect(results.violations).toEqual([]);
  });
}
