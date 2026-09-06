import { expect, test } from "@playwright/test";

/**
 * Issue #1474: the /ads/:domain wall must visually separate verified-link
 * creatives (the exact set the Ad Aggression Score and the "what changed"
 * feed are built from) from search-only matches. This prod-public test
 * asserts the live wall on /ads/notion.so:
 *   (a) the wall header reports both verified and search-only counts,
 *   (b) the verified-Notion cards carry the .f9-ads-verified-badge signal
 *       and lead the wall,
 *   (c) the search-only "Notion Press Publishing" card does NOT carry it.
 * Runs via `--project=prod-public` against https://0509.io once the change
 * is deployed (prod-public's testDir is ./e2e, file suffix
 * .prod-public.spec.ts is required by the project's testMatch).
 */
// Shared-resource lock (issue #1727): live external production surface.
test("ads wall labels verified-link cards and separates them from search-only matches", { lock: "external-api" }, async ({ page }) => {
  const response = await page.goto("/ads/notion.so", { waitUntil: "domcontentloaded" });
  expect(response?.status(), "/ads/notion.so must return 200 (cache miss 301s)").toBe(200);

  const wallHeading = page.locator("#brand-wall-title");
  await expect(wallHeading).toBeVisible();

  // (a) The wall header reports BOTH counts: "All N ads — V verified, M
  // matched the search".
  const header = (await wallHeading.textContent()) ?? "";
  const split = header.match(
    /All (\d+) ads? — (\d+) verified, (\d+) matched the search/,
  );
  expect(split, `wall header reports the verified split, got: "${header}"`).toBeTruthy();
  const total = Number(split![1]);
  const verified = Number(split![2]);
  const matched = Number(split![3]);
  expect(verified, "verified count is positive on the live Notion wall").toBeGreaterThan(0);
  expect(matched, "search-only count is positive on the live Notion wall").toBeGreaterThan(0);
  expect(verified + matched, "verified + matched equals the wall total").toBe(total);

  const cards = page.locator("article.f9-ads-card:not(.f9-ads-card-more)");
  await expect(cards.first()).toBeVisible();
  const cardCount = await cards.count();
  expect(cardCount).toBeGreaterThan(0);

  // Walk every visible wall card: verified cards carry the signal, search-only
  // cards never do. Verified cards render first, so when the whole verified
  // set fits the visible wall, the signal-card count equals the verified count.
  let signalCards = 0;
  let pressPublishingCard = false;
  let pressPublishingHasSignal = false;
  for (let i = 0; i < cardCount; i += 1) {
    const card = cards.nth(i);
    const text = (await card.textContent()) ?? "";
    const hasSignal =
      (await card.locator(".f9-ads-verified-badge, [data-verified-link]").count()) > 0;
    if (hasSignal) signalCards += 1;
    if (text.includes("Notion Press Publishing")) {
      pressPublishingCard = true;
      pressPublishingHasSignal = hasSignal;
    }
  }

  // (b) The verified set carries the signal and leads the wall.
  expect(
    signalCards,
    `signal appears on exactly the visible verified cards (wall=${cardCount}, verified=${verified})`,
  ).toBe(Math.min(verified, cardCount));

  // (c) The search-only "Notion Press Publishing" card is NOT badged.
  expect(pressPublishingCard, "search-only Notion Press Publishing card is on the live wall").toBe(true);
  expect(pressPublishingHasSignal, "Notion Press Publishing must not carry the verified signal").toBe(false);

  // The signal is glanceable prose, not a buried attribute.
  await expect(
    page.locator("article.f9-ads-card .f9-ads-verified-badge").first(),
  ).toContainText("Verified link");

  // The honest tail still names the verified/search-only split (accept #5).
  const honest = (await page.locator(".f9-ads-honest").textContent()) ?? "";
  expect(honest).toContain("matched the search");
});