import type { DatabaseSync } from "node:sqlite";

import { expect, test } from "./test";

import { isLocalLane, run, seedPreviewSession } from "./inbox";

test.skip(!isLocalLane(), "seeds a workspace in the local preview database; never run against production");

test.use({ viewport: { width: 375, height: 812 } });

const NAMES = [
  "Northbeam International Holdings",
  "Fernhill Quarterly Supply Company",
  "Oakline Outfitters",
  "Quartz & Lane Goods",
  "Copperfield Supply",
];

function seed({ db, suffix, userId }: { db: DatabaseSync; suffix: string; userId: string }): void {
  const stamp = "2026-10-01T00:00:00.000Z";
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    `ws-${suffix}`,
    "Phone",
    userId,
    stamp,
  );
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'self', ?, 'Self Brand', 'on', ?)",
    `ent-self-${suffix}`,
    `ws-${suffix}`,
    `self-${suffix}.example`,
    stamp,
  );
  for (const [index, name] of NAMES.entries()) {
    run(
      db,
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'competitor', ?, ?, 'on', ?)",
      `ent-r${String(index)}-${suffix}`,
      `ws-${suffix}`,
      `rival${String(index)}-${suffix}.example`,
      name,
      stamp,
    );
  }
}

test("competitor names show in full and the page does not scroll sideways at 375px", async ({ page }) => {
  const { cookie } = await seedPreviewSession("competitors-mobile", seed);
  await page.setExtraHTTPHeaders({ cookie });
  await page.goto("/app/competitors");

  const list = page.getByRole("list", { name: "Competitors" });
  for (const name of NAMES) {
    const label = list.getByText(name, { exact: true });
    await expect(label).toBeVisible();
    const clipped = await label.evaluate((node) => node.scrollWidth > node.clientWidth);
    expect(clipped, `${name} is clipped`).toBe(false);
  }

  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(widths.scrollWidth, JSON.stringify(widths)).toBe(widths.clientWidth);
});

test("each row keeps its name, switch and domain tidy on a phone", async ({ page }) => {
  const { cookie } = await seedPreviewSession("competitors-mobile-rows", seed);
  await page.setExtraHTTPHeaders({ cookie });
  await page.goto("/app/competitors");

  const rows = page.getByRole("list", { name: "Competitors" }).getByRole("listitem");
  await expect(rows).toHaveCount(NAMES.length);
  for (let index = 0; index < NAMES.length; index += 1) {
    const row = rows.nth(index);
    const chip = await row.getByRole("link").first().boundingBox();
    const toggle = await row.getByRole("switch").boundingBox();
    const domain = await row.getByText(`rival${String(index)}-`).boundingBox();
    expect(chip, "chip box").not.toBeNull();
    expect(toggle, "switch box").not.toBeNull();
    expect(domain, "domain box").not.toBeNull();
    expect(toggle?.y ?? 0, "switch sits on the chip's row").toBeLessThan((chip?.y ?? 0) + (chip?.height ?? 0));
    expect(domain?.y ?? 0, "domain sits under the chip").toBeGreaterThanOrEqual((chip?.y ?? 0) + (chip?.height ?? 0));
    expect(Math.abs((domain?.x ?? 0) - (chip?.x ?? 99)), "domain shares the chip's left edge").toBeLessThan(2);
  }
});
