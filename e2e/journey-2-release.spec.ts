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

    await page.goto("/app/onboard?website=nykaa.com");
    await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();
    await expect(
      page.getByText(
        "Start with one competitor. We will validate the website, create its watchlist, and queue the first evidence scan.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("The first scan starts immediately. Evidence appears as soon as the source check finishes."),
    ).toBeVisible();
    const onboardingWebsite = page.getByLabel("Competitor website");
    await expect(onboardingWebsite).toHaveValue("nykaa.com");
    await onboardingWebsite.focus();
    await expect(onboardingWebsite).toBeFocused();
    await expectMinimumTouchTarget(onboardingWebsite);
    await expectFocusTransition(
      onboardingWebsite,
      page.locator("form.f9-onboard-single-form details > summary").first(),
    );
    await expectVisibleKeyboardFocus(onboardingWebsite);
    await expectPhoneTouchTargets(page);
    const onboardingSubmit = page.locator("form.f9-onboard-single-form button[type='submit']");
    await expect(onboardingSubmit).toHaveAccessibleName("Start tracking Nykaa");
    await expect(onboardingSubmit).toBeEnabled();
    await onboardingWebsite.fill("");
    await expect(onboardingSubmit).toHaveAccessibleName("Start tracking this competitor");
    await expect(onboardingSubmit).toBeDisabled();
    await onboardingWebsite.fill("nykaa.com");
    await expect(onboardingSubmit).toHaveAccessibleName("Start tracking Nykaa");
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
    await page.goto("/app/onboard");
    await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();
    const website = page.getByLabel("Competitor website");
    await expect(website).toHaveAttribute("aria-describedby", "onboard-competitor-hint");
    await expect(website).toHaveAttribute("aria-invalid", "false");
    await expectMinimumTouchTarget(website);
    await expectFocusTransition(
      website,
      page.locator("form.f9-onboard-single-form details > summary").first(),
    );
    await expectVisibleKeyboardFocus(website);
    await expectPhoneTouchTargets(page);
    const submit = page.getByRole("button", { name: /Start tracking/i });
    await expect(submit).toBeDisabled();
    await attachReleaseStateArtifacts({ page, testInfo, prefix: "j2-activation", state: "onboard" });
    await website.fill("https://nykaa.com");
    await expect(submit).toBeEnabled();
    await expectPrimaryActionAboveFold(submit, "onboarding tracking action");
    await expectMinimumTouchTarget(submit);
    await expectVisibleKeyboardFocus(submit);
    await expectPhoneTouchTargets(page);
    await submit.press("Enter");
    await expect(page).toHaveURL(/\/app\/watchlists\?watchlist=[^&]+/);
    await expect(page.getByRole("heading", { name: "Watchlists" })).toBeVisible();
    const nykaaWatch = page.getByRole("link", { name: /Nykaa watch\s+Competitor · Nykaa/i }).first();
    await expect(nykaaWatch).toBeVisible();
    await expect(nykaaWatch.getByRole("heading", { name: "Nykaa watch", exact: true })).toBeVisible();
    await expect(nykaaWatch.getByText("Competitor · Nykaa", { exact: true })).toBeVisible();
    if (viewport.name === "mobile") {
      const deskHeading = page.getByRole("heading", { name: "Tracking desk", exact: true });
      const deskIntro = page.getByText(
        "Pick a tracked brand to review changes, evidence freshness, and alert delivery.",
        { exact: true },
      );
      const [headingBox, introBox] = await Promise.all([
        deskHeading.boundingBox(),
        deskIntro.boundingBox(),
      ]);
      expect(headingBox, "mobile tracking-desk heading should be measurable").not.toBeNull();
      expect(introBox, "mobile tracking-desk intro should be measurable").not.toBeNull();
      if (headingBox && introBox) {
        expect(
          introBox.y - (headingBox.y + headingBox.height),
          "mobile tracking-desk content should not be stretched apart",
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
