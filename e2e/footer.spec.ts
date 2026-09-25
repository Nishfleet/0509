import { expect, test } from "@playwright/test";

// This spec traces to the `/`, `/login`, `/privacy` and `/terms` rows in
// .agents/skills/verify/feature-map.md: each route's footer carries the Privacy
// link, the Terms link and the takedown address support@0509.io, in the same order
// with the same markup. The landing cannot import the shared Footer (it is a
// static document), so its footer is a hand-kept copy of the same three anchors.
//
// Copy is pattern-matched, never pinned verbatim: the landing h1 lesson
// (2026-09-21T16:03Z) turned every copy edit into a red gate. What is asserted
// is the contract - the link exists, is visible, is labelled and points at the
// right destination - plus the source order, which is what "same order" means
// here.
const PUBLIC_ROUTES = ["/", "/login", "/privacy", "/terms"] as const;

const PRIVACY_HREF = 'a[href="/privacy"]';
const TERMS_HREF = 'a[href="/terms"]';
const SUPPORT_HREF = 'a[href="mailto:support@0509.io"]';

for (const route of PUBLIC_ROUTES) {
  test(`${route} footer carries privacy, terms and the takedown address`, async ({ page }) => {
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

    // The anchors sit in the footer's own source order, compared without
    // layout: the static landing has no gap utilities, so its separator is a
    // text span, and the only cross-route invariant that survives is that the
    // address comes first on every route.
    const [supportIndex, privacyIndex, termsIndex] = await Promise.all([
      support.evaluate((element) => Array.from(element.closest("footer")?.children ?? []).indexOf(element)),
      privacy.evaluate((element) => Array.from(element.closest("footer")?.children ?? []).indexOf(element)),
      terms.evaluate((element) => Array.from(element.closest("footer")?.children ?? []).indexOf(element)),
    ]);

    expect(privacyIndex).toBeGreaterThan(supportIndex);
    expect(termsIndex).toBeGreaterThan(privacyIndex);
  });
}
