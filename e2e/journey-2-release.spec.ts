import { expect, test, type BrowserContext, type Page } from "./helpers/release-test";
import {
  expectFocusTransition,
  expectMinimumTouchTarget,
  expectNoHorizontalOverflow,
  expectPhoneTouchTargets,
  expectPrimaryActionAboveFold,
  expectStatusAnnouncement,
  expectVisibleKeyboardFocus,
} from "./helpers/release-experience";
import { attachReleaseStateArtifacts } from "./helpers/release-artifacts";
import { requireExactReleaseBaseURL } from "./helpers/release-origin";

const fixtureCookie = "f9_e2e_fixture";
const fixtureModeHeader = "x-0509-e2e-test-mode";
/**
 * How long to let a client-side navigation commit before asserting that none
 * happened. Asserting an ABSENCE needs a bounded window — a retrying matcher
 * cannot help, because it passes on the first (still-correct) sample. Measured
 * against the deliberately-broken build in `scripts/bl025-mutation-check.sh`:
 * the navigation commits within ~100ms of the refusal rendering, so 1s is ten
 * times the observed worst case and costs one second in one test.
 */
const NAVIGATION_COMMIT_WINDOW_MS = 1_000;
const viewports = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 900 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

async function signInAs(context: BrowserContext, baseURL: string | undefined, userId: string) {
  const url = requireExactReleaseBaseURL(baseURL);
  await context.setExtraHTTPHeaders({
    [fixtureModeHeader]: "1",
    "x-0509-e2e-search-rollout": "v2",
  });
  await context.addCookies([
    {
      name: fixtureCookie,
      value: userId,
      url,
      sameSite: "Lax",
    },
  ]);
}

const activationPersonaByViewport = {
  mobile: "e2e-activation",
  tablet: "e2e-activation-tablet",
  desktop: "e2e-activation-desktop",
} as const;

async function expectProofImageAccessibleNames(page: Page) {
  // A fallback format label may read “image”, but it must not become an
  // unlabeled image role. Real captured creatives need a descriptive alt.
  await expect(page.getByRole("img", { name: /^image$/i })).toHaveCount(0);
  const images = page.locator(".f9-ad-thumb-row img, .f9-results-list img");
  for (let index = 0; index < await images.count(); index += 1) {
    const image = images.nth(index);
    await expect(image).toHaveAttribute("alt", /\S+/u);
    expect((await image.getAttribute("alt"))?.trim()).not.toMatch(/^image$/iu);
  }
}

for (const viewport of viewports) {
  test(`Gate-B Journey 2: onboarding to search to credible proof (${viewport.name})`, async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    expect(page.viewportSize()).toEqual({ width: viewport.width, height: viewport.height });
    test.info().annotations.push(
      { type: "persona", description: "e2e-free" },
      { type: "viewport", description: `${viewport.width}x${viewport.height}` },
      { type: "scenario", description: "onboarding → search → credible proof" },
    );
    await signInAs(context, baseURL, "e2e-free");

    await page.goto("/app?website=nykaa.com#setup-checklist");
    await expect(page.getByRole("heading", { name: "Finish the workspace that sends your first brief" })).toBeVisible();
    await expect(
      page.getByText(
        "Paste one competitor website to start.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("We create the watchlist and start its first scan immediately."),
    ).toBeVisible();
    const onboardingWebsite = page.getByLabel("Competitor website");
    await expect(onboardingWebsite).toHaveValue("nykaa.com");
    await onboardingWebsite.focus();
    await expect(onboardingWebsite).toBeFocused();
    await expectMinimumTouchTarget(onboardingWebsite);
    await expectFocusTransition(
      onboardingWebsite,
      page.locator("form.f9-ed-setup-primary button[type='submit']"),
    );
    await expectVisibleKeyboardFocus(onboardingWebsite);
    await expectPhoneTouchTargets(page);
    const onboardingSubmit = page.locator("form.f9-ed-setup-primary button[type='submit']");
    await expect(onboardingSubmit).toHaveAccessibleName("Track Nykaa");
    await expect(onboardingSubmit).toBeEnabled();
    await onboardingWebsite.fill("");
    // BL-025: the Rank-1 is never rendered disabled (brief §5) — the washed
    // ink fill under a live accent offset read half-built. The name still
    // tracks the field, and the refusal of an empty website is proven against
    // the action in "persistent setup card keeps an empty free workspace
    // honest" below.
    await expect(onboardingSubmit).toHaveAccessibleName("Track this competitor");
    await expect(onboardingSubmit).toBeEnabled();
    await onboardingWebsite.fill("nykaa.com");
    await expect(onboardingSubmit).toHaveAccessibleName("Track Nykaa");
    await expect(onboardingSubmit).toBeEnabled();
    await expectNoHorizontalOverflow(page);
    await attachReleaseStateArtifacts({ page, testInfo, prefix: "j2-proof", state: "onboard" });

    const searchFirst = page.getByRole("link", { name: "Search first instead" });
    await expect(searchFirst).toHaveAttribute("href", "/search?website=nykaa.com");
    await searchFirst.click();
    await expect(page).toHaveURL(/\/search\?website=nykaa\.com$/);
    await expect(page.getByRole("heading", { name: "Find competitor ads" })).toBeVisible();
    const searchSubmit = page.getByRole("button", { name: "See ads" });
    await expectPrimaryActionAboveFold(searchSubmit, "search results action");
    await expectMinimumTouchTarget(searchSubmit);

    // Validation, healthy-empty and delayed-source transitions precede credible recovery.
    const searchWebsite = page.getByLabel("Competitor website");
    await expect(searchWebsite).toHaveValue("nykaa.com");
    await expectVisibleKeyboardFocus(searchWebsite);
    await searchWebsite.fill("not-a-domain");
    await page.keyboard.press("Enter");
    const inputAlert = page.getByRole("alert");
    await expectStatusAnnouncement(
      inputAlert,
      "That website looks incomplete. Add the full domain, like brand.com.",
      "alert",
    );
    await expect(page.getByRole("heading", { name: "Enter a competitor website" })).toBeVisible();
    await expect(page.locator(".f9-results-panel")).toHaveAttribute("data-f9-result-cache-status", "none");
    await expect(page.locator(".f9-results-panel")).toHaveAttribute("data-f9-result-source", "demo");
    await expectPhoneTouchTargets(page);
    await attachReleaseStateArtifacts({ page, testInfo, prefix: "j2-proof", state: "invalid" });

    await searchWebsite.fill("fresh-empty.example");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/website=fresh-empty\.example/);
    await expect(page.getByRole("heading", { name: "No verified ads found for fresh-empty.example" })).toBeVisible();
    await expectStatusAnnouncement(
      page.locator('[role="status"][aria-live="polite"]').filter({ hasText: /No search results found/i }),
      "No search results found. Search complete.",
    );
    await expect(page.locator(".f9-results-panel")).toHaveAttribute("data-f9-result-cache-status", "hit");
    await expect(page.locator(".f9-results-panel")).toHaveAttribute("data-f9-result-source", "meta_library_browser");
    await expectPhoneTouchTargets(page);
    await attachReleaseStateArtifacts({ page, testInfo, prefix: "j2-proof", state: "empty" });

    await searchWebsite.fill("stale.example");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/website=stale\.example/);
    await expect(page.getByRole("heading", { name: "Search preview is temporarily unavailable" })).toBeVisible();
    await expect(
      page.getByText(
        "Live ad checks are temporarily delayed. We'll retry automatically — results refresh as soon as checks recover.",
      ),
    ).toBeVisible();
    await expectStatusAnnouncement(
      page.locator('[role="status"][aria-live="polite"]').filter({ hasText: /No results loaded/i }),
      "No results loaded. Fresh checks are delayed, so coverage may be incomplete.",
    );
    await expect(page.locator(".f9-results-panel")).toHaveAttribute("data-f9-result-cache-status", "stale");
    await expect(page.locator(".f9-results-panel")).toHaveAttribute("data-f9-result-source", "meta_library_browser");
    await expectPhoneTouchTargets(page);
    await attachReleaseStateArtifacts({ page, testInfo, prefix: "j2-proof", state: "degraded" });

    await searchWebsite.fill("nykaa.com");
    await expectMinimumTouchTarget(searchWebsite);
    await expectVisibleKeyboardFocus(searchWebsite);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/search\?.*website=nykaa\.com/);
    const result = page.getByRole("link", { name: /Nykaa.*Festive glow/i }).first();
    await expect(result).toBeVisible();
    await expectMinimumTouchTarget(result);
    await expectVisibleKeyboardFocus(result);
    await expectStatusAnnouncement(
      page.locator('[role="status"][aria-live="polite"]').filter({ hasText: /1 search result loaded/i }),
      "1 search result loaded. No more results. Search checks have recovered.",
    );
    await result.press("Enter");
    await expect(page).toHaveURL(/\/search\?.*selected=e2e-nykaa-live-1/);
    const selectedUrl = new URL(page.url());
    expect(selectedUrl.searchParams.get("selected")).toBe("e2e-nykaa-live-1");
    expect(selectedUrl.searchParams.get("website")).toBe("nykaa.com");
    expect(selectedUrl.searchParams.get("query")).toBe("nykaa.com");
    expect(selectedUrl.searchParams.get("mode")).toBe("advertiser");
    expect(selectedUrl.searchParams.get("trackingRole")).toBe("competitor");
    const proofSummary = page.locator(".f9-proof-summary");
    await expect(proofSummary).toBeFocused();
    await expect(proofSummary.getByRole("heading", { name: "Nykaa" })).toBeVisible();
    await expect(proofSummary.getByText("Source: Meta Ad Library visual check")).toBeVisible();
    await expect(proofSummary.getByText("Recent cached result")).toBeVisible();
    await expect(proofSummary.getByText("Landing page not captured yet")).toBeVisible();
    await expect(proofSummary.getByRole("heading", { name: "Festive glow sale" })).toBeVisible();
    await expect(page.locator(".f9-results-panel")).toHaveAttribute("data-f9-result-cache-status", "hit");
    await expect(page.locator(".f9-results-panel")).toHaveAttribute("data-f9-result-source", "meta_library_browser");
    await expectProofImageAccessibleNames(page);
    const trackCompetitor = page.getByRole("button", { name: /Track this competitor/i });
    await expect(trackCompetitor).toBeVisible();
    await expectMinimumTouchTarget(trackCompetitor);
    await expectPhoneTouchTargets(page);
    await expectNoHorizontalOverflow(page);
    const finalUrl = new URL(page.url());
    await attachReleaseStateArtifacts({ page, testInfo, prefix: "j2-proof", state: "proof" });
    test.info().annotations.push({
      type: "finalUrl",
      description: `${finalUrl.pathname}${finalUrl.search}`,
    });
  });

  test(`Gate-B Journey 2: onboarding creates the first tracked competitor (${viewport.name})`, async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    expect(page.viewportSize()).toEqual({ width: viewport.width, height: viewport.height });
    const persona = activationPersonaByViewport[viewport.name];
    test.info().annotations.push(
      { type: "persona", description: persona },
      { type: "viewport", description: `${viewport.width}x${viewport.height}` },
      { type: "scenario", description: "onboarding → watchlist → first scan state" },
    );
    await signInAs(context, baseURL, persona);
    await page.goto("/app#setup-checklist");
    await expect(page.getByRole("heading", { name: "Finish the workspace that sends your first brief" })).toBeVisible();
    const website = page.getByLabel("Competitor website");
    await expect(website).toHaveAttribute("aria-describedby", "setup-competitor-hint");
    await expect(website).toHaveAttribute("aria-invalid", "false");
    await expectMinimumTouchTarget(website);
    // BL-025: Tab out of the website field now lands on the card's Rank-1,
    // which is no longer rendered disabled and therefore no longer skipped in
    // the tab order. The guarantee is unchanged — the next stop after the
    // field is a real, reachable control, not a keyboard dead end.
    await expectFocusTransition(
      website,
      page.locator("form.f9-ed-setup-primary button[type='submit']").first(),
    );
    await expectVisibleKeyboardFocus(website);
    await expectPhoneTouchTargets(page);
    const submit = page.locator("form.f9-ed-setup-primary button[type='submit']");
    await expect(submit).toBeEnabled();
    await attachReleaseStateArtifacts({ page, testInfo, prefix: "j2-activation", state: "onboard" });
    await website.fill("https://nykaa.com");
    await expect(submit).toBeEnabled();
    await expectPrimaryActionAboveFold(submit, "onboarding tracking action");
    await expectMinimumTouchTarget(submit);
    await expectVisibleKeyboardFocus(submit);
    await expectPhoneTouchTargets(page);
    await submit.press("Enter");
    await expect(page).toHaveURL(/\/app\/watchlists\?watchlist=[^&]+/);
    await expect(page.getByRole("heading", { level: 1, name: "Competitors", exact: true })).toBeVisible();
    const nykaaWatch = page.getByRole("link", { name: /Nykaa watch\s+Competitor · Nykaa/i }).first();
    await expect(nykaaWatch).toBeVisible();
    await expect(nykaaWatch.getByRole("heading", { name: "Nykaa watch", exact: true })).toBeVisible();
    await expect(nykaaWatch.getByText("Competitor · Nykaa", { exact: true })).toBeVisible();
    if (viewport.name === "mobile") {
      // BL-006 replaced the master/detail side panel (and its "Pick a tracked
      // brand…" intro) with the watch board. The guarantee this assertion
      // protects is unchanged: a competitor's identity must not be stretched
      // apart down the phone screen — it is now measured on the band itself.
      const bandName = nykaaWatch.getByRole("heading", { name: "Nykaa watch", exact: true });
      const bandMeta = page.locator(".f9-ed-band-meta").first();
      const [nameBox, metaBox] = await Promise.all([
        bandName.boundingBox(),
        bandMeta.boundingBox(),
      ]);
      expect(nameBox, "mobile band name should be measurable").not.toBeNull();
      expect(metaBox, "mobile band meta lines should be measurable").not.toBeNull();
      if (nameBox && metaBox) {
        expect(
          metaBox.y - (nameBox.y + nameBox.height),
          "mobile band content should not be stretched apart",
        ).toBeLessThanOrEqual(72);
      }
    }
    const scanBanner = page.locator("article[aria-live='polite']").filter({ hasText: /Activation scan/i }).first();
    await expect(scanBanner).toBeVisible();
    await expect(scanBanner).toHaveAttribute("aria-live", "polite");
    await expect(
      scanBanner.getByRole("heading", { name: "Activation scan safely paused", exact: true }),
    ).toBeVisible();
    await expect(scanBanner).toContainText(
      "Provider access is disabled in this local release proof. No external check was attempted.",
    );
    await expectNoHorizontalOverflow(page);
    await expectPhoneTouchTargets(page);
    const finalUrl = new URL(page.url());
    await attachReleaseStateArtifacts({ page, testInfo, prefix: "j2-activation", state: "activation-paused" });
    const createdWatchlistId = finalUrl.searchParams.get("watchlist");
    expect(createdWatchlistId).toBeTruthy();
    await expect(page.locator('input[name="watchlistId"]').first()).toHaveValue(createdWatchlistId!);
    test.info().annotations.push({ type: "finalUrl", description: `${finalUrl.pathname}${finalUrl.search}` });
  });
}

test("persistent setup card keeps an empty free workspace honest", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  test.info().annotations.push(
    { type: "persona", description: "e2e-free-onboarded" },
    { type: "scenario", description: "first-run-beat-1-empty-free" },
    { type: "viewport", description: "1440x900" },
  );
  await signInAs(context, baseURL, "e2e-free-onboarded");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app");
  await expect(page.locator("#f9-main-content").getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("#setup-checklist")).toBeVisible();
  await expect(page.locator("#setup-checklist")).toContainText("Setup · 0 of 4 done");
  await expect(page.locator("#setup-checklist")).toContainText("First competitor");
  await expect(page.getByText("We file the first brief before you wake.")).toHaveCount(0);
  await expect(page.locator(".f9-first-run-spine")).toHaveCount(0);
  const trackCompetitor = page.getByRole("button", { name: "Track this competitor", exact: true });
  await expect(trackCompetitor).toBeVisible();

  // BL-025 — the checklist state is one §6.3 status strip, not four repeated
  // title+sentence rows, and every step still states itself in words so colour
  // is never the only channel (brief §10).
  const setupTrack = page.locator(".f9-ed-setup-track");
  await expect(setupTrack.locator("li")).toHaveCount(4);
  await expect(setupTrack).toContainText("Now");
  await expect(setupTrack).toContainText("Still to come");
  await expect(page.locator(".f9-ed-setup-row")).toHaveCount(0);
  await expect(page.locator(".f9-ed-setup-stamp")).toHaveCount(0);

  // The Rank-1 is enabled (§5), and an empty website is refused by the action
  // with the honest message rather than by a dead-looking button.
  await expect(trackCompetitor).toBeEnabled();

  // A refused submit must not navigate the browser AT ALL. Two wrong outcomes
  // have to fail here: `/app/watchlists?watchlist=…` (the submit wrongly
  // succeeded — the original point of this check) and `/app?index` (React
  // Router's index-route action marker; `app.dashboard.tsx` is the index child
  // of `/app`, so a navigating <Form> lands there). That second URL is what
  // made Gate-B's coverage annotation unresolvable and caused the first BL-025
  // BLOCK, so this test has to be able to catch it coming back — which is why
  // the setup form is a fetcher.
  //
  // Sampling `page.url()` straight after `click()` proves nothing: click
  // resolves on dispatch, and a client-side navigation commits its URL
  // asynchronously — measured at up to ~100ms AFTER the refusal has already
  // rendered. An earlier version of this assertion did exactly that and so
  // passed against the very `/app?index` it was written to reject. Record
  // main-frame navigations from before the click, wait for the refusal, then
  // give any pending navigation a bounded window to commit before asserting
  // that none did. Both halves are proven by scripts/bl025-mutation-check.sh.
  const navigations: string[] = [];
  const recordNavigation = (frame: { url(): string }) => {
    if (frame !== page.mainFrame()) return;
    const navigated = new URL(page.mainFrame().url());
    navigations.push(`${navigated.pathname}${navigated.search}`);
  };
  page.on("framenavigated", recordNavigation);
  await trackCompetitor.click();
  await expect(page.locator(".f9-ed-setup-message")).toBeVisible();
  await expect(
    page.getByText("We didn't start anything — there's no website to check yet."),
  ).toBeVisible();
  await expect(page.getByText("Paste the competitor's full address, like brand.com.")).toBeVisible();
  await expect(page.locator("#setup-checklist")).toBeVisible();
  await page.waitForTimeout(NAVIGATION_COMMIT_WINDOW_MS);
  page.off("framenavigated", recordNavigation);
  expect(navigations, "a refused submit must not navigate the browser").toEqual([]);

  // With no navigation recorded the URL cannot have moved, so this is now a
  // statement of the canonical value rather than a lucky sample. Compare the
  // complete path+query: `toHaveURL(/\/app(\?|$)/)` and `pathname === "/app"`
  // both accept `/app?index`.
  const refusedUrl = new URL(page.url());
  expect(
    `${refusedUrl.pathname}${refusedUrl.search}`,
    "empty submit must leave the browser on the canonical /app, with no index or watchlist marker",
  ).toBe("/app");
  expect(refusedUrl.searchParams.has("index"), "no React Router index marker").toBe(false);
  expect(refusedUrl.searchParams.has("watchlist"), "no watchlist was created").toBe(false);

  await expect(page.locator("body")).not.toContainText(/stakeout|under watch|on camera|surveillance/i);
  await expectNoHorizontalOverflow(page);
  await expectPhoneTouchTargets(page);
  await attachReleaseStateArtifacts({ page, testInfo, prefix: "j2-first-run-beat-1", state: "first-run-empty-free" });

  // The card is *persistent* — the thing this scenario is named for. A refused
  // submit writes nothing, so a reload must land back on a clean 0-of-4 card
  // rather than a half-created workspace. This also returns the journey to the
  // canonical `/app` that RELEASE_COVERAGE_MATRIX annotates for this scenario.
  await page.goto("/app");
  await expect(page.locator("#setup-checklist")).toBeVisible();
  await expect(page.locator("#setup-checklist")).toContainText("Setup · 0 of 4 done");
  await expect(page.locator(".f9-ed-setup-message")).toHaveCount(0);
  const finalUrl = new URL(page.url());
  test.info().annotations.push({ type: "finalUrl", description: `${finalUrl.pathname}${finalUrl.search}` });
});
