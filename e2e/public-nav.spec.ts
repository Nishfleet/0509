import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./test";

const PAGES = ["/pricing", "/privacy", "/terms"] as const;

for (const path of PAGES) {
  test(`${path} carries the same site header: wordmark, Overview and Sign in @smoke`, async ({ page }) => {
    await page.goto(path);

    await expect(page.getByRole("banner")).toHaveCount(1);
    const nav = page.getByRole("navigation", { name: "Site" });
    await expect(nav.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute("href", "/");
    await expect(nav.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/login");
    await expect(page.getByRole("banner").getByRole("link", { name: "Five to Nine" })).toHaveAttribute("href", "/");
  });
}

test("/ carries a Site nav with Pricing and Sign in, and Pricing opens the price page @smoke", async ({ page }) => {
  await page.goto("/");

  const nav = page.getByRole("navigation", { name: "Site" });
  await expect(nav.getByRole("link", { name: "Pricing", exact: true })).toHaveAttribute("href", "/pricing");
  await expect(nav.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/login");

  await nav.getByRole("link", { name: "Pricing", exact: true }).click();
  await page.waitForURL(/\/pricing$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pick how closely you watch.");
});

test("pricing opens on one headline and shows the plan buttons without scrolling on a laptop @smoke", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/pricing");

  const headline = page.getByRole("heading", { level: 1 });
  await expect(headline).toHaveCount(1);
  await expect(headline).toHaveText("Pick how closely you watch.");
  await expect(page.getByRole("heading", { level: 2, name: "Pick how closely you watch." })).toHaveCount(0);

  const levels = await page
    .locator("h1, h2, h3, h4, h5, h6")
    .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
  expect(levels[0]).toBe(1);
  for (let i = 1; i < levels.length; i += 1) {
    expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  }

  const buttons = page.getByRole("link", { name: /^Start with / });
  await expect(buttons).toHaveCount(3);
  for (const index of [0, 1, 2]) {
    const box = await buttons.nth(index).boundingBox();
    expect(box?.y !== undefined && box.height > 0 && box.y + box.height <= 900, `plan button ${String(index)}`).toBe(
      true,
    );
  }
});

const TOKEN = "0".repeat(32);
const FOOTER_LINKS = [
  ["Privacy", "/privacy"],
  ["Terms", "/terms"],
  ["Pricing", "/pricing"],
  ["API docs", "/api/docs"],
] as const;

const WALK_PAGES = [
  { path: "/", skip: false, links: FOOTER_LINKS.slice(0, 2) },
  { path: "/pricing", skip: true, links: FOOTER_LINKS },
  { path: "/privacy", skip: true, links: FOOTER_LINKS },
  { path: "/terms", skip: true, links: FOOTER_LINKS },
  { path: "/api/docs", skip: true, links: FOOTER_LINKS },
  { path: "/login", skip: true, links: FOOTER_LINKS },
  { path: `/v/${TOKEN}`, skip: false, links: FOOTER_LINKS },
  { path: `/u/${TOKEN}`, skip: false, links: FOOTER_LINKS },
] as const;

async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let presses = 0; presses < 60; presses += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error("Tab never reached the link");
}

for (const { path, skip, links } of WALK_PAGES) {
  test(`${path.replace(TOKEN, ":token")} footer links open by tap and by Tab+Enter, and Back returns here`, async ({
    page,
  }) => {
    const footer = page.locator("footer").last();
    const landed = (href: string) => new RegExp(`${href.replaceAll("/", "\\/")}$`);

    for (const [name, href] of links.filter(([, own]) => own !== path)) {
      await page.goto(path);
      await footer.getByRole("link", { name, exact: true }).click();
      await page.waitForURL(landed(href));
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await page.goBack();
      await page.waitForURL(path);
      await expect(footer.getByRole("link", { name, exact: true })).toBeVisible();

      await page.goto(path);
      const link = footer.getByRole("link", { name, exact: true });
      await tabTo(page, link);
      await expect(link).toHaveCSS("outline-style", "solid");
      await page.keyboard.press("Enter");
      await page.waitForURL(landed(href));
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    }
  });

  if (skip) {
    test(`${path} skip link is the first Tab stop and moves to the page content`, async ({ page }) => {
      await page.goto(path);
      await page.keyboard.press("Tab");
      const focused = page.locator(":focus");
      await expect(focused).toHaveAttribute("href", "#main-content");
      await expect(focused).toHaveText("Skip to content");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/#main-content$/);
      await expect(page.locator("#main-content")).toBeFocused();
    });
  }
}

for (const path of ["/pricing", "/privacy", "/terms"]) {
  test(`${path} header Overview, Sign in and wordmark open by tap and by Tab+Enter, and Back returns here`, async ({
    page,
  }) => {
    const header = page.getByRole("banner");
    const targets = [
      [header.getByRole("link", { name: "Overview", exact: true }), /\/$/],
      [header.getByRole("link", { name: "Sign in", exact: true }), /\/login$/],
      [header.getByRole("link", { name: "Five to Nine" }), /\/$/],
    ] as const;

    for (const [link, landed] of targets) {
      await page.goto(path);
      await link.click();
      await page.waitForURL(landed);
      await page.goBack();
      await page.waitForURL(path);

      await page.goto(path);
      await tabTo(page, link);
      await page.keyboard.press("Enter");
      await page.waitForURL(landed);
    }
  });
}
