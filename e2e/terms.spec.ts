import { expect, test } from "@playwright/test";

// The /terms contract. Every assertion here is reachable from the /terms row in
// .agents/skills/verify/feature-map.md.
//
// Copy is pattern-matched, never pinned verbatim (the landing h1 lesson,
// 2026-09-21T16:03Z). What is asserted is the contract: business use only,
// public sources with no completeness promise, fair use, read-only agent keys,
// generic plans with cancel-any-time, the liability cap, the governing law, the
// link to /privacy, and the footer address. No plan name or price is pinned:
// billing is undecided, and prices live in app/lib/billing/plans.ts.

test("the terms page renders its heading and date", async ({ page }) => {
  const response = await page.goto("/terms");
  expect(response?.status()).toBe(200);

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading).not.toBeEmpty();
  await expect(page.locator("main time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
});

test("the terms page states who can use 0509 and what it does", async ({ page }) => {
  await page.goto("/terms");

  const main = page.locator("main");
  await expect(main).toContainText(/for a business/i);
  await expect(main).toContainText(/private individual/i);
  await expect(main).toContainText(/public data is never complete/i);
  await expect(main).toContainText(/degraded/i);
  await expect(main).toContainText(/not legal, financial or professional advice/i);
});

test("the terms page covers agents, sharing, plans and cancelling", async ({ page }) => {
  await page.goto("/terms");

  const main = page.locator("main");
  await expect(main).toContainText(/cannot change it/i);
  await expect(main).toContainText(/publishes no pages about you/i);
  await expect(main).toContainText(/cancel any time/i);
  await expect(main).toContainText(/end of the period you already paid for/i);
  await expect(main).not.toContainText(/€|EUR/);
});

test("the terms page caps liability and names the governing law", async ({ page }) => {
  await page.goto("/terms");

  const main = page.locator("main");
  await expect(main).toContainText(/capped at what you paid us/i);
  await expect(main).toContainText(/governed by the laws of \S/i);
  await expect(main).not.toContainText(/!/);
});

test("the terms page links privacy and the contents list reaches every section", async ({ page }) => {
  await page.goto("/terms");

  await expect(page.locator('main section a[href="/privacy"]')).toBeVisible();
  const links = page.getByRole("navigation", { name: "On this page" }).getByRole("link");
  await expect(links).toHaveCount(await page.locator("main h2").count());
  for (const href of await links.evaluateAll((all) => all.map((a) => a.getAttribute("href")))) {
    await expect(page.locator(`main h2${href ?? ""}`)).toHaveCount(1);
  }
});

test("the terms footer carries the support address and both legal links", async ({ page }) => {
  await page.goto("/terms");

  const footer = page.locator("footer");
  await expect(footer.locator('a[href="mailto:support@0509.io"]')).toBeVisible();
  await expect(footer.locator('a[href="/privacy"]')).toBeVisible();
  await expect(footer.locator('a[href="/terms"]')).toBeVisible();
});

test("the terms page does not scroll horizontally", async ({ page }) => {
  await page.goto("/terms");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test("the terms page reaches first paint with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/terms");
  await page.waitForLoadState("networkidle");

  expect(errors).toEqual([]);
});

test("the terms page serves one ld+json graph naming the organization and breadcrumbs", async ({
  page,
}) => {
  await page.goto("/terms");

  const scripts = page.locator('script[type="application/ld+json"]');
  await expect(scripts).toHaveCount(1);

  const parsed = JSON.parse((await scripts.textContent()) ?? "");
  const types = parsed["@graph"].map((node: { "@type": string }) => node["@type"]);
  expect(types).toEqual(["Organization", "BreadcrumbList"]);
});
