import { expect, test } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  expectPrimaryActionAboveFold,
} from "../../e2e/helpers/release-experience";

/**
 * BET 9 hero first-viewport gate (issue #1875).
 *
 * The termination command:
 *   npx playwright test tests/design/hero-viewport.spec.ts \
 *     --project=chromium --project=mobile-chromium
 * exits 0 with screenshots showing the headline, value proposition, and
 * clickable CTA all inside the first viewport at desktop (1440×900) and
 * mobile (390×844), with zero console errors and no horizontal overflow.
 *
 * The `chromium` and `mobile-chromium` projects target the live homepage by
 * default (E2E_PROD_BASE_URL, same source as `prod-public`), so this is the
 * live canary that proves the deployed hero meets the design gate — the same
 * posture as `scripts/bet9-first-viewport-verification.mjs`. Point
 * E2E_PROD_BASE_URL at a local fixture server (e.g.
 * http://127.0.0.1:4179) to run it against a local build.
 *
 * The H1 wording is Nish's call; this gate asserts the buyer+job headline
 * EXISTS and is the single <h1>, the value proposition is visible, the proof
 * mechanic is demoted to a strip beneath the H1, and the search input + CTA
 * clear the fold — not any specific string.
 */

// The H1 must name the buyer ("growth teams") and the job (tracking
// competitors / knowing the offer). Matches the landed "Safe" direction.
const BUYER_JOB_H1 = /growth teams.*competitor|competitor.*growth teams/i;

test(`BET 9 hero: headline + value prop + CTA in first viewport, zero console errors`, async ({
  page,
}) => {
  const viewport = page.viewportSize();
  expect(viewport, "project must configure a viewport").not.toBeNull();
  const label = viewport!.width >= 1000 ? "desktop-1440" : "mobile-390";

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await page.goto("/", { waitUntil: "domcontentloaded" });
  // Let the Bricolage 800 wall and the proof strip settle so bounding boxes
  // match the rendered layout, not a pre-font fallback.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);

  // One <h1>, naming the buyer and the job.
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toHaveCount(1);
  await expect(h1).toBeVisible();
  await expect(h1).toContainText(BUYER_JOB_H1);

  // The value proposition is present as visible copy (the deck paragraph).
  const deckCopy = page.locator(".ld-deck-copy").first();
  await expect(deckCopy, "value proposition deck copy is present").toBeVisible();
  await expect(deckCopy, "value proposition names what the product watches").toContainText(
    /watches competitors/i,
  );

  // The proof mechanic is preserved and demoted to a strip beneath the H1,
  // not promoted into the headline. The aria-label is "Live proof brief" when
  // proof is live/empty, or "Cached proof brief — checked ..." when cached —
  // match both so the gate holds in either production state.
  const proofStrip = page.getByRole("complementary", {
    name: /(live|cached) proof brief/i,
  });
  await expect(proofStrip, "live-proof strip is preserved beneath the H1").toHaveCount(1);

  const h1Box = await h1.boundingBox();
  const stripBox = await proofStrip.boundingBox();
  expect(h1Box, "H1 has a measurable box").not.toBeNull();
  expect(stripBox, "proof strip has a measurable box").not.toBeNull();
  if (h1Box && stripBox) {
    expect(
      stripBox.y,
      "proof strip starts below the H1 (demoted, not the headline)",
    ).toBeGreaterThanOrEqual(h1Box.y + h1Box.height - 1);
  }

  // The search input and its primary CTA are both above the fold.
  const searchInput = page.getByLabel("Competitor website").first();
  const searchCta = page.getByRole("button", { name: /Preview available ads/i });
  await expect(searchInput, "search input is rendered").toBeVisible();
  await expect(searchCta, "search CTA is rendered").toBeVisible();
  await expectPrimaryActionAboveFold(searchInput, "homepage search input");
  await expectPrimaryActionAboveFold(searchCta, "homepage search CTA");

  // No horizontal scroll (closes the residual ld-ticker-belt / ld-flag
  // overflow tracked in #1262 / #1486).
  await expectNoHorizontalOverflow(page);

  // No console errors fire on the first viewport.
  expect(pageErrors, `expected zero page errors, got: ${pageErrors.join(" | ")}`).toEqual([]);

  // Screenshot evidence: the first viewport showing headline + value prop +
  // CTA. Saved next to Playwright's outputDir so the termination command
  // leaves a visible artefact.
  await page.screenshot({
    path: `test-results/design/hero-viewport-${label}.png`,
  });
});
