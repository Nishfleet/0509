import { expect, test } from "@playwright/test";

// The /privacy contract (0509#3986). Every assertion here is reachable from the
// /privacy row in .agents/skills/verify/feature-map.md.
//
// Copy is pattern-matched, never pinned verbatim: a merge-queue proof that
// asserts exact strings turns every wording edit into a red gate (the landing
// h1 lesson, 2026-09-21T16:03Z). What is asserted is the contract: who we
// refuse, what we collect, who helps run 0509, no public pages, one-year
// retention, remove and forget, the 72-hour removal, the rights, the contents
// list, and the footer address. The thirty-day feed rule is absent on purpose:
// it is an R2 lifecycle rule not yet shown live.

test("the privacy page renders its heading", async ({ page }) => {
  const response = await page.goto("/privacy");
  expect(response?.status()).toBe(200);

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading).not.toBeEmpty();
});

test("the privacy page states who we track and what we refuse", async ({ page }) => {
  await page.goto("/privacy");

  const main = page.locator("main");
  await expect(main).toContainText(/brands, companies, products, and creators/i);
  await expect(main).toContainText(/private individual/i);
  await expect(main).toContainText(/minors/i);
  await expect(main).toContainText(/marked private/i);
  await expect(main).toContainText(/behind a login/i);
});

test("the privacy page states what we collect about customers and brands", async ({ page }) => {
  await page.goto("/privacy");

  const main = page.locator("main");
  await expect(main).toContainText(/email address/i);
  await expect(main).toContainText(/IP address/i);
  await expect(main).toContainText(/public pages/i);
  await expect(main).toContainText(/direct messages/i);
  await expect(main).toContainText(/purchased personal data/i);
  await expect(main).toContainText(/full text/i);
  await expect(main).toContainText(/never sell/i);
});

test("the privacy page names who helps run 0509", async ({ page }) => {
  await page.goto("/privacy");

  const helpers = page.locator("section", { has: page.locator("#who-helps") }).locator("dt");
  await expect(helpers).toContainText(["Cloudflare", "AI model providers", "payment provider", "Sentry", "Gmail", "GitHub"]);
});

test("the privacy page says sharing is a picture and there are no public pages", async ({ page }) => {
  await page.goto("/privacy");

  const main = page.locator("main");
  await expect(main).toContainText(/picture/i);
  await expect(main).toContainText(/nothing about your workspace is published at a public web address/i);
  await expect(main).toContainText(/cannot change anything/i);
  await expect(main).toContainText(/no cookie banner/i);
});

test("the privacy page states retention, deletion, rights, and the 72-hour removal", async ({
  page,
}) => {
  await page.goto("/privacy");

  const main = page.locator("main");
  await expect(main).toContainText(/one year/i);
  await expect(main).toContainText(/incident records/i);
  await expect(main).toContainText(/remove and forget/i);
  await expect(main).toContainText(/72 hours/i);
  await expect(main).toContainText(/data protection authority/i);
  await expect(main).not.toContainText(/30 days after|thirty.day/i);
  await expect(main).not.toContainText(/!/);
});

test("the privacy contents list links every section", async ({ page }) => {
  await page.goto("/privacy");

  const links = page.getByRole("navigation", { name: "On this page" }).getByRole("link");
  const headings = page.locator("main h2");
  await expect(links).toHaveCount(await headings.count());
  for (const href of await links.evaluateAll((all) => all.map((a) => a.getAttribute("href")))) {
    await expect(page.locator(`main h2${href ?? ""}`)).toHaveCount(1);
  }
});

test("the privacy footer carries the takedown address", async ({ page }) => {
  await page.goto("/privacy");

  const takedown = page.locator('footer a[href="mailto:support@0509.io"]');
  await expect(takedown).toBeVisible();
  await expect(takedown).toHaveAccessibleName(/\S/);
});

test("the privacy wordmark loads the landing page", async ({ page }) => {
  await page.goto("/privacy");
  await page.locator('a[href="/"]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('a[href="mailto:support@0509.io"]')).toBeVisible();
});

test("the privacy page does not scroll horizontally", async ({ page }) => {
  await page.goto("/privacy");
  const width = page.viewportSize()?.width ?? 0;
  const edges = await page.evaluate(() => {
    return ["main", "footer a"].map((selector) => {
      const element = document.querySelector(selector);
      if (element === null) {
        throw new Error(`selector matched nothing: ${selector}`);
      }
      const rect = element.getBoundingClientRect();
      return { selector, left: rect.left, right: rect.right };
    });
  });
  for (const edge of edges) {
    expect(edge.left, `${edge.selector} left edge`).toBeGreaterThanOrEqual(0);
    expect(edge.right, `${edge.selector} right edge`).toBeLessThanOrEqual(width + 1);
  }
});

test("the privacy page reaches first paint with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/privacy");
  await page.waitForLoadState("networkidle");

  expect(errors).toEqual([]);
});

test("the privacy page serves one ld+json graph naming the organization and breadcrumbs", async ({
  page,
}) => {
  await page.goto("/privacy");

  const scripts = page.locator('script[type="application/ld+json"]');
  await expect(scripts).toHaveCount(1);

  const parsed = JSON.parse((await scripts.textContent()) ?? "");
  const types = parsed["@graph"].map((node: { "@type": string }) => node["@type"]);
  expect(types).toEqual(["Organization", "BreadcrumbList"]);
});
