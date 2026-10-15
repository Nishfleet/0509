import { expect, test } from "./test";

const PUBLIC_ROUTES = ["/", "/login", "/pricing", "/privacy", "/terms", "/security"] as const;

const PRIVACY_HREF = 'a[href="/privacy"]';
const TERMS_HREF = 'a[href="/terms"]';
const SUPPORT_HREF = 'a[href="mailto:support@0509.io"]';

for (const route of PUBLIC_ROUTES) {
  test(`${route} footer carries privacy, terms and the takedown address @smoke`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);

    const footer = page.locator("footer").last();
    const privacy = footer.locator(PRIVACY_HREF);
    const terms = footer.locator(TERMS_HREF);
    const support = footer.locator(SUPPORT_HREF);

    await expect(privacy).toBeVisible();
    await expect(privacy).toHaveAccessibleName(/\S/);
    await expect(terms).toBeVisible();
    await expect(terms).toHaveAccessibleName(/\S/);
    await expect(support).toBeVisible();
    await expect(support).toHaveAccessibleName(/\S/);

    await expect(footer.locator('a[href="/security"]')).toBeVisible();
    await expect(footer.locator('a[href="/status"]')).toBeVisible();
    await expect(footer.locator('a[href="/pricing"]')).toBeVisible();
    await expect(footer.locator('a[href="/api/docs"]')).toBeVisible();

    const [supportIndex, privacyIndex, termsIndex] = await Promise.all([
      support.evaluate((element) => Array.from(element.closest("footer")?.children ?? []).indexOf(element)),
      privacy.evaluate((element) => Array.from(element.closest("footer")?.children ?? []).indexOf(element)),
      terms.evaluate((element) => Array.from(element.closest("footer")?.children ?? []).indexOf(element)),
    ]);

    expect(privacyIndex).toBeGreaterThan(supportIndex);
    expect(termsIndex).toBeGreaterThan(privacyIndex);
  });
}
