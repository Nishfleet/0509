import { expect, test } from "@playwright/test";

import { PLANS, TRIAL_TERMS } from "../app/lib/billing/plans";
import { consoleFailures, watchConsole } from "./inbox";

// The /pricing contract (0509#5601). Every assertion is reachable from the
// /pricing row in .agents/skills/verify/feature-map.md. Plan names, prices and
// the trial line are read from app/lib/billing/plans.ts, never typed here.

const PATH = "/pricing";

test("the pricing page states every plan and its monthly price @smoke", async ({ page }) => {
  const response = await page.goto(PATH);
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  const plans = page.locator("main li").filter({ has: page.getByRole("heading", { level: 3 }) });
  await expect(plans).toHaveCount(PLANS.length);
  for (const [index, plan] of PLANS.entries()) {
    const card = plans.nth(index);
    await expect(card.getByRole("heading", { level: 3, name: plan.name })).toBeVisible();
    await expect(card).toContainText(`€${String(plan.monthlyPriceEur)}/month`);
  }
});

test("the pricing page states the trial terms from the plans module @smoke", async ({ page }) => {
  await page.goto(PATH);

  const main = page.locator("main");
  await expect(main).toContainText(TRIAL_TERMS);
  await expect(main).toContainText(/7-day/);
  await expect(main).toContainText(/day 8/);
});

test("the pricing page is indexable and carries its own canonical and offers @smoke", async ({ page }) => {
  await page.goto(PATH);

  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/pricing$/);

  const graph = await page.locator('script[type="application/ld+json"]').first().textContent();
  const nodes: unknown = JSON.parse(graph ?? "{}");
  const offers = JSON.stringify(nodes);
  for (const plan of PLANS) {
    expect(offers).toContain(`"name":"${plan.name}"`);
    expect(offers).toContain(`"price":"${plan.monthlyPriceEur.toFixed(2)}"`);
  }
});

test("the start button leads to sign-in and carries a known utm_source only @smoke", async ({ page }) => {
  await page.goto(PATH);
  const start = page.locator("main").getByRole("link", { name: /Start watching/ });
  await expect(start).toHaveAttribute("href", "/login");

  for (const source of ["organic", "llms", "share"]) {
    await page.goto(`${PATH}?utm_source=${source}`);
    await expect(start).toHaveAttribute("href", `/login?utm_source=${source}`);
  }

  await page.goto(`${PATH}?utm_source=elsewhere`);
  await expect(start).toHaveAttribute("href", "/login");
});

test("the pricing page links back to the overview and carries the footer links @smoke", async ({ page }) => {
  await page.goto(PATH);

  await expect(page.getByRole("link", { name: "Back to overview" })).toHaveAttribute("href", "/");
  const footer = page.locator("footer");
  await expect(footer.locator('a[href="/privacy"]')).toBeVisible();
  await expect(footer.locator('a[href="/terms"]')).toBeVisible();
  await expect(footer.locator('a[href="mailto:support@0509.io"]')).toBeVisible();
});

test("the pricing page has no console errors and no horizontal scroll @smoke", async ({ page }, testInfo) => {
  const watched = watchConsole(page);
  await page.goto(PATH);
  await expect(page.locator("main")).toBeVisible();

  const size = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(size.scrollWidth, JSON.stringify(size)).toBeLessThanOrEqual(size.clientWidth);
  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});

test("the sitemap and llms.txt list the pricing page and robots.txt allows it @smoke", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toMatch(/<loc>https?:\/\/[^<]+\/pricing<\/loc>/);

  const llms = await (await request.get("/llms.txt")).text();
  expect(llms).toMatch(/^- \[Pricing\]\(https?:\/\/[^)]+\/pricing\): \S/m);

  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).not.toMatch(/^Disallow: \/pricing/m);
});
