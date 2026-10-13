import type { DatabaseSync } from "node:sqlite";

import { expect, test, type Page } from "@playwright/test";

import { consoleFailures, isLocalLane, run, seedPreviewSession, watchConsole } from "./inbox";

test.skip(
  !isLocalLane(),
  "the preview Worker signs in through a seeded session; production reads a live feed in developments-feed.spec.ts",
);

const KINDS = [
  { label: "Ads", kind: "ad", title: "Spring sale ad" },
  { label: "Site changes", kind: "change", title: "Pro plan price changed" },
  { label: "Mentions", kind: "mention", title: "Zephyrwear opens a flagship" },
  { label: "Hiring", kind: "hiring", title: "Senior engineer role" },
] as const;

function seed({ db, suffix, userId }: { db: DatabaseSync; suffix: string; userId: string }): string {
  const stamp = "2026-10-12T00:00:00.000Z";
  const workspaceId = `ws-${suffix}`;
  const entityId = `ent-z-${suffix}`;
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    workspaceId,
    "Developments Preview",
    userId,
    stamp,
  );
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'self', ?, 'Self Brand', ?)",
    `ent-self-${suffix}`,
    workspaceId,
    `self-${suffix}.example`,
    stamp,
  );
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'competitor', ?, 'Zephyrwear', ?)",
    entityId,
    workspaceId,
    `zephyr-${suffix}.example`,
    stamp,
  );
  const sourceId = `src-dev-${suffix}`;
  run(
    db,
    "INSERT INTO source (id, key, kind, platform, plugin_key, reliability, is_enabled, config_json) VALUES (?, ?, 'mentions', 'medium', ?, 'rss', 1, '{}')",
    sourceId,
    `dev.feed-${suffix}`,
    `dev.feed-${suffix}`,
  );
  const now = Date.now();
  KINDS.forEach((item, index) => {
    const url = `https://${item.kind}.example/${suffix}`;
    run(
      db,
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, title, url, canonical_url, url_hash, aspect, payload_json, dedup_key, observed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
      `sig-${item.kind}-${suffix}`,
      workspaceId,
      entityId,
      sourceId,
      item.kind,
      item.title,
      url,
      url,
      `hash-${item.kind}-${suffix}`,
      item.kind === "change" ? "pricing" : null,
      `dedup-${item.kind}-${suffix}`,
      new Date(now - (index + 1) * 3_600_000).toISOString(),
    );
  });
  return entityId;
}

function chip(page: Page, label: string) {
  return page.locator("[data-slot='toggle-group-item']").filter({ hasText: label });
}

function list(page: Page) {
  return page.locator("[data-slot='developments-list']");
}

test("the developments feed counts each kind, filters by it and survives a reload", async ({
  page,
  baseURL,
}, testInfo) => {
  const watched = watchConsole(page);
  const { cookie, seeded } = await seedPreviewSession("developments", seed);
  await page.context().addCookies(
    cookie.split("; ").map((pair) => {
      const [name, ...value] = pair.split("=");
      return { name, value: value.join("="), url: baseURL ?? "" };
    }),
  );

  await page.goto(`/app/competitors/${seeded}`);
  await expect(page.locator("[data-slot='developments-feed']")).toBeVisible();
  await expect(chip(page, "All").locator("span")).toHaveText("4");
  for (const item of KINDS) {
    await expect(chip(page, item.label).locator("span")).toHaveText("1");
  }
  await expect(list(page).locator(":scope > li")).toHaveCount(4);

  for (const item of KINDS) {
    await chip(page, item.label).click();
    await expect(page).toHaveURL(new RegExp(`[?&]kind=${item.kind}`));
    await expect(list(page).locator(":scope > li")).toHaveCount(1);
    await expect(list(page).getByText(item.title)).toBeVisible();
  }

  await page.reload();
  await expect(page).toHaveURL(/[?&]kind=hiring/);
  await expect(list(page).getByText("Senior engineer role")).toBeVisible();

  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.innerWidth);
  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
