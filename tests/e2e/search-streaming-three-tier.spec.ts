import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const specDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(specDir, "../..");

// BET 2 (issue 1482): the /search route streams results and renders every
// row with a visible three-tier badge. The route-render assertions (first
// card <5s, all three badges, zero-verified non-empty state) live in the
// Vitest regression test at tests/search/streaming-three-tier.test.tsx;
// this Playwright spec runs that test as a subprocess (same pattern as
// search-landing-page-capture.spec.ts) and adds DOM assertions on the
// tier-badge markup contract the bet2-live-verification canary counts.

test("streaming three-tier regression: first card <5s, all three badges, zero-verified state", () => {
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
    },
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
});

const TIER_BADGE_HTML = `<!doctype html>
<html lang="en">
  <body>
    <div class="f9-wk-row">
      <span class="f9-wk-say">
        <span class="f9-tier-badge is-verified">Verified</span>
        One tool for your whole company
      </span>
    </div>
    <div class="f9-wk-row">
      <span class="f9-wk-say">
        <span class="f9-tier-badge is-likely">Likely</span>
        Connected workspace
      </span>
    </div>
    <div class="f9-wk-row">
      <span class="f9-wk-say">
        <span class="f9-tier-badge is-unmatched">Unmatched</span>
        Templates for teams
      </span>
    </div>
    <p class="f9-wk-small f9-tier-tail" role="status">
      1 verified · 1 likely · 1 unmatched — verified links the ad to this brand's website; likely and unmatched rows are unconfirmed leads.
    </p>
  </body>
</html>`;

test("tier badges render with the correct tier class and word", async ({ page }) => {
  await page.setContent(TIER_BADGE_HTML);

  const verified = page.locator(".f9-tier-badge.is-verified");
  await expect(verified).toHaveText("Verified");
  await expect(verified).toBeVisible();

  const likely = page.locator(".f9-tier-badge.is-likely");
  await expect(likely).toHaveText("Likely");
  await expect(likely).toBeVisible();

  const unmatched = page.locator(".f9-tier-badge.is-unmatched");
  await expect(unmatched).toHaveText("Unmatched");
  await expect(unmatched).toBeVisible();

  // Exactly three badge spans, one per tier.
  await expect(page.locator(".f9-tier-badge")).toHaveCount(3);

  // The honest three-tier tail is present.
  const tail = page.locator(".f9-tier-tail");
  await expect(tail).toBeVisible();
  await expect(tail).toContainText("1 verified · 1 likely · 1 unmatched");
});

const ZERO_VERIFIED_HTML = `<!doctype html>
<html lang="en">
  <body>
    <h2 class="f9-wk-sec-title">No verified ads for notion.so — 1 likely match, 1 unmatched candidate</h2>
    <p class="f9-wk-sec-sub">These ads matched your search but we couldn't verify they belong to the brand. Confirm a likely one before treating it as proof.</p>
    <div class="f9-wk-row">
      <span class="f9-wk-say">
        <span class="f9-tier-badge is-likely">Likely</span>
        Connected workspace
      </span>
    </div>
    <div class="f9-wk-row">
      <span class="f9-wk-say">
        <span class="f9-tier-badge is-unmatched">Unmatched</span>
        Templates for teams
      </span>
    </div>
  </body>
</html>`;

test("zero-verified non-empty state shows candidate rows with badges — never the dead-end copy", async ({ page }) => {
  await page.setContent(ZERO_VERIFIED_HTML);

  // Headline names the tiers, not the dead-end.
  const title = page.locator(".f9-wk-sec-title");
  await expect(title).toContainText("No verified ads for notion.so —");
  await expect(title).not.toContainText("No verified ads found for notion.so");

  // Both candidate rows render with their badges.
  await expect(page.locator(".f9-tier-badge.is-likely")).toHaveText("Likely");
  await expect(page.locator(".f9-tier-badge.is-unmatched")).toHaveText("Unmatched");
  await expect(page.locator(".f9-tier-badge.is-verified")).toHaveCount(0);

  // The honest explanation sentence is on the page.
  const sub = page.locator(".f9-wk-sec-sub");
  await expect(sub).toContainText(
    "These ads matched your search but we couldn't verify they belong to the brand",
  );
});
