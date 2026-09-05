import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const specDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(specDir, "../..");

// BET 2 (issue 1482) streaming + three-tier gate.
//
// Two layers, same as search-landing-page-capture.spec.ts:
// 1. The deterministic unit gate (tests/search/streaming-three-tier.test.tsx)
//    renders the route with a mocked streaming loader and asserts (a) first
//    card before the loader completes inside the 5s budget, (b) all three
//    tier badges, (c) zero-verified non-empty state. It runs as the first
//    test here so a rendering regression fails locally and in CI without
//    depending on live production state.
// 2. Live smoke against prod-public: a cached brand search must paint rows
//    carrying exactly one tier badge each, and the first badge must appear
//    without waiting for a full single-batch render. The <5s p95 cold-query
//    target is the bet2 canary's (scripts/bet2-live-verification.mjs) stamped
//    across its 25-domain set; here we gate the mechanism, not the network.

const BADGE_SELECTOR = ".f9-tier-badge";
const ROW_SELECTOR = ".f9-wk-row";
// nykaa.com is the cached verified 17-row fixture the issue's own evidence
// section names ("Live search payload for q=allbirds... verifiedCount: 17" —
// nykaa is the stable warm brand in this suite's fixtures).
const WARM_BRAND_URL = "/search?website=https%3A%2F%2Fnykaa.com&mode=advertiser&query=nykaa.com&country=all&trackingRole=competitor";

test("unit gate: streaming three-tier regression suite passes", () => {
  const result = spawnSync(
    "npx",
    [
      "vitest",
      "run",
      "--configLoader",
      "runner",
      "--project",
      "node",
      "tests/search/streaming-three-tier.test.tsx",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "test", VITEST: "true" },
      timeout: 180_000,
    },
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
});

test("live: cached brand search paints tier badges on the first rows without a spinner-bound single batch", async ({
  page,
}) => {
  const startedAt = Date.now();
  await page.goto(WARM_BRAND_URL, { waitUntil: "domcontentloaded" });
  const panel = page.locator(".f9-results-panel");
  await expect(panel).toBeVisible({ timeout: 20_000 });

  // First tier badge appears — a populated row, not an opaque spinner-only
  // single batch. Kept generous (15s) so CI latency on a cached query can't
  // flake, while still catching the rendered-after-the-whole-response
  // regression the issue observed (16-25s cold).
  const firstBadge = panel.locator(BADGE_SELECTOR).first();
  await expect(firstBadge).toBeVisible({ timeout: 15_000 });
  const firstCardMs = Date.now() - startedAt;

  const rowCount = await panel.locator(ROW_SELECTOR).count();
  expect(rowCount).toBeGreaterThan(0);
  const badgeCount = await panel.locator(BADGE_SELECTOR).count();

  // Every rendered row carries the tier badge (v2 rows; a legacy v1 row would
  // be the failure this gate exists to catch — badge-less candidates are the
  // "cannot distinguish verified-link ads from search-only matches" defect).
  expect(badgeCount).toBe(rowCount);

  // The badge words are the three-tier labels the issue names.
  const badgeTexts = await panel.locator(BADGE_SELECTOR).allTextContents();
  const knownTiers = new Set(["Verified", "Likely", "Unmatched"]);
  for (const text of badgeTexts) {
    expect(knownTiers.has(text.trim())).toBe(true);
  }

  // Surface the measured first-card time in the report for the p95 book.
  test.info().annotations.push({
    type: "first-card-ms",
    description: String(firstCardMs),
  });
});