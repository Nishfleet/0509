import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { expect, test } from "./test";

import { consoleFailures, isLocalLane, run, seedPreviewSession, watchConsole } from "./inbox";

test.skip(
  !isLocalLane(),
  "the price changes are rows in the local preview database and objects in the local R2; production reads live rivals",
);

const PRICES = [
  { from: "Starter €40/mo", to: "Starter €46/mo", daysAgo: 20 },
  { from: "Starter €46/mo", to: "Starter €52/mo", daysAgo: 5 },
];

function putDiff(key: string, from: string, to: string): void {
  const file = join(mkdtempSync(join(tmpdir(), "pricing-diff-")), "diff.json");
  writeFileSync(file, JSON.stringify({ hunks: [{ lines: [" context", `-${from}`, `+${to}`] }] }));
  execFileSync("npx", ["wrangler", "r2", "object", "put", `0509-snapshots/${key}`, "--file", file, "--local"], {
    stdio: "ignore",
  });
}

function seed({ db, suffix, userId }: { db: DatabaseSync; suffix: string; userId: string }): string {
  const workspaceId = `ws-${suffix}`;
  const entityId = `ent-z-${suffix}`;
  const url = `https://zephyr-${suffix}.example/pricing`;
  const stamp = new Date(Date.now() - 30 * 86_400_000).toISOString();
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    workspaceId,
    "Pricing Timeline",
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
  PRICES.forEach((price, n) => {
    const diffKey = `snapshot/site/${suffix}-${n}/site-change.diff.json`;
    putDiff(diffKey, price.from, price.to);
    const payload = {
      page: { role: "pricing", url },
      before: { snapshotId: `snap-b-${n}-${suffix}`, screenshotKey: null },
      after: { snapshotId: `snap-a-${n}-${suffix}`, screenshotKey: null },
      diffKey,
      wordsAdded: 1,
      wordsRemoved: 1,
    };
    const seen = new Date(Date.now() - price.daysAgo * 86_400_000).toISOString();
    run(
      db,
      `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, url, evidence_url, payload_json, dedup_key, observed_at, last_seen_at)
       VALUES (?, ?, ?, 'src_site_web', 'change', 'pricing', ?, ?, ?, ?, ?, ?)`,
      `sig-price-${n}-${suffix}`,
      workspaceId,
      entityId,
      url,
      url,
      JSON.stringify(payload),
      `dedup-price-${n}-${suffix}`,
      seen,
      seen,
    );
  });
  return entityId;
}

test("a rival's price changes read oldest first with the old line struck and announced", async ({
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(120_000);
  const watched = watchConsole(page);
  const { cookie, seeded } = await seedPreviewSession("pricing-timeline", seed);
  await page.context().addCookies(
    cookie.split("; ").map((pair) => {
      const [name, ...value] = pair.split("=");
      return { name, value: value.join("="), url: baseURL ?? "" };
    }),
  );

  await page.goto(`/app/competitors/${seeded}`);
  const section = page.locator("[data-section='pricing-timeline']");
  await expect(section.getByRole("heading", { name: "Pricing page over time" })).toBeVisible();
  const steps = section.getByRole("listitem");
  await expect(steps).toHaveCount(2);
  await expect(steps.nth(0)).toContainText("Starter €40/mo");
  await expect(steps.nth(0)).toContainText("Starter €46/mo");
  await expect(steps.nth(1)).toContainText("Starter €52/mo");
  await expect(steps.nth(0).locator(".sr-only").first()).toHaveText("Was ");
  await expect(steps.nth(0).locator(".line-through")).toHaveText("Starter €40/mo");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
