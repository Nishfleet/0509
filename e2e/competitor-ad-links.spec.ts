import type { DatabaseSync } from "node:sqlite";

import { expect, test, type Page } from "@playwright/test";

import { isLocalLane } from "./inbox";
import { run, seedPreviewSession } from "./preview-session";

const BRAND = "Boots & Belle";
const DOMAIN = "shop.boots-belle.example";

test.skip(
  !isLocalLane(),
  "the competitor is a row in the local preview database; production signs in through the magic-link inbox and has no fixture workspace",
);

function seed({ db, suffix, userId }: { db: DatabaseSync; suffix: string; userId: string }): void {
  const stamp = "2026-09-28T00:00:00.000Z";
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    `ws-${suffix}`,
    "Ad Links",
    userId,
    stamp,
  );
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'self', ?, 'Self Brand', ?)",
    `ent-self-${suffix}`,
    `ws-${suffix}`,
    `self-${suffix}.example`,
    stamp,
  );
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'competitor', ?, ?, ?)",
    `ent-${suffix}`,
    `ws-${suffix}`,
    DOMAIN,
    BRAND,
    stamp,
  );
}

async function openCompetitor(page: Page, width: number): Promise<void> {
  const cookie = await seedPreviewSession("ad-links", (context) => {
    seed(context);
  });
  await page.setExtraHTTPHeaders({ cookie });
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/app/competitors");
  await page
    .getByRole("list", { name: "Competitors" })
    .getByRole("link", { name: /Boots/ })
    .first()
    .press("Enter");
  await expect(page).toHaveURL(/\/app\/competitors\/ent-/);
}

test("the competitor header carries Their ads on Meta and Their ads on Google links", async ({ page }) => {
  await openCompetitor(page, 1440);

  const meta = page.getByRole("link", { name: `${BRAND}'s ads on Meta (opens in a new tab)`, exact: true });
  const google = page.getByRole("link", { name: `${BRAND}'s ads on Google (opens in a new tab)`, exact: true });
  await expect(meta).toHaveText("Their ads on Meta");
  await expect(google).toHaveText("Their ads on Google");

  for (const link of [meta, google]) {
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  }

  const metaUrl = new URL((await meta.getAttribute("href")) ?? "");
  expect(metaUrl.hostname).toBe("www.facebook.com");
  expect(metaUrl.pathname).toBe("/ads/library/");
  expect(metaUrl.searchParams.get("search_type")).toBe("keyword_exact_phrase");
  expect(metaUrl.searchParams.get("q")).toBe(`"${BRAND}"`);

  const googleUrl = new URL((await google.getAttribute("href")) ?? "");
  expect(googleUrl.hostname).toBe("adstransparency.google.com");
  expect(googleUrl.searchParams.get("region")).toBe("anywhere");
  expect(googleUrl.searchParams.get("domain")).toBe(DOMAIN);
});

test("the competitor header ad links wrap without horizontal scroll at 390px", async ({ page }) => {
  await openCompetitor(page, 390);
  await expect(page.getByRole("link", { name: `${BRAND}'s ads on Meta (opens in a new tab)`, exact: true })).toBeVisible();
  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth);
});
