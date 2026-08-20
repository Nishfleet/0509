import { expect, test, type Page } from "./helpers/release-test";
import {
  expectMinimumTouchTarget,
  expectNoHorizontalOverflow,
  expectFocusTransition,
  expectPhoneTouchTargets,
  expectPrimaryActionAboveFold,
  expectReducedMotionSafe,
  expectStatusAnnouncement,
  expectVisibleKeyboardFocus,
} from "./helpers/release-experience";
import { attachReleaseStateArtifacts } from "./helpers/release-artifacts";

const viewports = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 900 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

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

async function expectMarketingPrimaryNavigation(page: Page): Promise<void> {
  const navigation = page.getByRole("navigation", { name: "Primary", exact: true });
  await expect(navigation).toBeVisible();

  for (const label of ["Search preview", "Proof brief", "Pricing"] as const) {
    const link = navigation.getByRole("link", { name: label, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", /\S+/u);
    await expectMinimumTouchTarget(link);
    await expectVisibleKeyboardFocus(link);
  }
}

async function expectPublicSearchNavigation(page: Page): Promise<void> {
  const navigation = page.getByRole("navigation", { name: "Search", exact: true });
  await expect(navigation).toBeVisible();

  const viewport = page.viewportSize();
  const requireTouchTargets = Boolean(viewport && viewport.width <= 900);
  for (const label of ["Home", "Search", "Pricing", "Help"] as const) {
    const link = navigation.getByRole("link", { name: label, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", /\S+/u);
    if (requireTouchTargets) await expectMinimumTouchTarget(link);
    await expectVisibleKeyboardFocus(link);
  }
}

const publicTruthSurfaces = [
  {
    state: "docs" as const,
    path: "/docs",
    heading: "Five to Nine docs.",
    truth: [
      "This documentation does not measure live provider availability.",
      "Provider availability can vary.",
    ],
  },
  {
    state: "status" as const,
    path: "/status",
    heading: "Five to Nine service status.",
    truth: [
      "This page provides configuration and scope information, not a live provider-health monitor.",
      "It does not measure live search, email, billing, or provider availability.",
    ],
  },
  {
    state: "help" as const,
    path: "/help",
    heading: "Get Five to Nine working for your team.",
    truth: [
      "Email delivery is in product scope, but this page does not measure live email-provider availability.",
      "Free lets you watch one competitor",
    ],
  },
  {
    state: "trust" as const,
    path: "/trust",
    heading: "Trust and security basics.",
    truth: [
      "This is the current lightweight trust surface. It does not make compliance claims that have not been verified.",
      "live provider availability is not measured here.",
    ],
  },
  {
    state: "privacy" as const,
    path: "/privacy",
    heading: "Five to Nine privacy basics.",
    truth: [
      "This is a plain-English summary of the current product behavior.",
      "Tracking status stays visible when results are recent, delayed, or freshly verified.",
    ],
  },
  {
    state: "terms" as const,
    path: "/terms",
    heading: "Five to Nine terms.",
    truth: [
      "These plain-English operating terms cover accounts using Five to Nine.",
      "Recent results, delayed checks, and fresh checks are labeled honestly wherever they appear.",
    ],
  },
] as const;

async function expectReadableBrandContrast(page: Page): Promise<void> {
  const brand = page.locator(".f9-legal-nav .f9-brandmark .f9-wordmark").first();
  const contrast = await brand.evaluate((element) => {
    const nav = element.closest<HTMLElement>(".f9-legal-nav");
    const parseRgb = (value: string): [number, number, number] | null => {
      const match = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/u);
      return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
    };
    const luminance = ([red, green, blue]: [number, number, number]) =>
      [red, green, blue]
        .map((channel) => channel / 255)
        .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
        .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const ratio = (foreground: [number, number, number] | null, background: [number, number, number] | null) => {
      if (!foreground || !background) return null;
      const foregroundLuminance = luminance(foreground);
      const backgroundLuminance = luminance(background);
      return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
    };
    const navBackground = nav ? parseRgb(getComputedStyle(nav).backgroundColor) : null;
    const baseRatio = ratio(parseRgb(getComputedStyle(element).color), navBackground);
    const bridge = element.querySelector<HTMLElement>(".f9-wordmark-bridge");
    const bridgeRatio = bridge
      ? ratio(parseRgb(getComputedStyle(bridge).color), parseRgb(getComputedStyle(bridge).backgroundColor))
      : null;
    if (baseRatio === null || bridgeRatio === null) return null;
    return Math.min(baseRatio, bridgeRatio);
  });

  expect(contrast, "brand wordmark contrast should be measurable").not.toBeNull();
  if (contrast !== null) {
    expect(contrast, "brand wordmark should meet readable contrast").toBeGreaterThanOrEqual(4.5);
  }
}

async function expectPublicTruthSurface(
  page: Page,
  testInfo: Parameters<typeof attachReleaseStateArtifacts>[0]["testInfo"],
  surface: (typeof publicTruthSurfaces)[number],
) {
  await page.goto(surface.path);
  await expect(page).toHaveURL(new RegExp(`${surface.path.replace("/", "\\/")}$`, "u"));
  await expect(page.getByRole("heading", { name: surface.heading, exact: true })).toBeVisible();
  for (const truth of surface.truth) {
    await expect(page.getByText(truth, { exact: false })).toBeVisible();
  }
  await expectReadableBrandContrast(page);
  await expectVisibleKeyboardFocus(page.locator(".f9-legal-nav .f9-brandmark").first());
  await expectPhoneTouchTargets(page);
  await expectNoHorizontalOverflow(page);
  await attachReleaseStateArtifacts({ page, testInfo, prefix: "j1", state: surface.state });
}

for (const viewport of viewports) {
  test(`Gate-B Journey 1: first visit to value to signup (${viewport.name})`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    expect(page.viewportSize()).toEqual({ width: viewport.width, height: viewport.height });
    await page.setExtraHTTPHeaders({
      "x-0509-e2e-test-mode": "1",
      "x-0509-e2e-search-rollout": "v2",
    });
    test.info().annotations.push(
      { type: "persona", description: "anonymous" },
      { type: "viewport", description: `${viewport.width}x${viewport.height}` },
      { type: "scenario", description: "first visit → value → signup" },
    );

    // First visit: establish the product promise without an account.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /saved the proof|before the call/i })).toBeVisible();
    await expect(page.getByText("No account needed.", { exact: true })).toBeVisible();
    const trialLink = page.getByRole("link", { name: "Try with Nykaa" });
    await expect(trialLink).toBeVisible();
    const trialHref = await trialLink.getAttribute("href");
    expect(trialHref).toBe("/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com");
    await trialLink.click();
    await expect(page).toHaveURL(/\/search\?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa\.com/);
    const trialUrl = new URL(page.url());
    expect(trialUrl.searchParams.get("query")).toBe("nykaa");
    expect(trialUrl.searchParams.get("mode")).toBe("advertiser");
    expect(trialUrl.searchParams.get("website")).toBe("https://nykaa.com");
    await page.goto("/");
    for (const surface of publicTruthSurfaces) {
      await expectPublicTruthSurface(page, testInfo, surface);
    }
    await page.goto("/");
    await expectNoHorizontalOverflow(page);

    await expectMarketingPrimaryNavigation(page);
    const homeWebsite = page.getByLabel("Competitor website").first();
    const homeSubmit = page.getByRole("button", { name: /Preview available ads/i });
    await expectPrimaryActionAboveFold(homeWebsite, "homepage live-search field");
    await expectPrimaryActionAboveFold(homeSubmit, "homepage live-search action");
    await expectMinimumTouchTarget(homeWebsite);
    await expectMinimumTouchTarget(homeSubmit);
    await expectFocusTransition(homeWebsite, homeSubmit);
    await expectFocusTransition(homeSubmit, trialLink);
    await expectFocusTransition(
      trialLink,
      page.getByRole("link", { name: "Review the proof brief" }),
    );
    await expectVisibleKeyboardFocus(homeWebsite);
    await expectPhoneTouchTargets(page);
    await expectReducedMotionSafe(page, page.locator(".ld-hero"));
    await attachReleaseStateArtifacts({ page, testInfo, prefix: "j1", state: "home" });

    // Failure/empty state: the form accepts focus and explains a malformed domain.
    await homeWebsite.fill("not-a-domain");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/search\?website=not-a-domain/);
    await expect(page.getByRole("heading", { name: "Find competitor ads" })).toBeVisible();
    await expectPublicSearchNavigation(page);
    const inputAlert = page.getByRole("alert");
    await expectStatusAnnouncement(
      inputAlert,
      "That website looks incomplete. Add the full domain, like brand.com.",
      "alert",
    );
    await expect(page.getByLabel("Competitor website").first()).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("heading", { name: "Enter a competitor website" })).toBeVisible();
    await expect(page.locator(".f9-results-panel")).toHaveAttribute("data-f9-result-cache-status", "none");
    await expect(page.locator(".f9-results-panel")).toHaveAttribute("data-f9-result-source", "demo");
    await expectNoHorizontalOverflow(page);
    await expectPhoneTouchTargets(page);
    await attachReleaseStateArtifacts({ page, testInfo, prefix: "j1", state: "invalid" });

    // Healthy empty and degraded cache-only states remain distinct and recoverable.
    const searchWebsite = page.getByLabel("Competitor website").first();
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
    const broaderLink = page.getByRole("link", { name: /Search broader matches for.*fresh-empty/i });
    await expect(broaderLink).toBeVisible();
    await expectMinimumTouchTarget(broaderLink);
    await expectVisibleKeyboardFocus(broaderLink);
    await expectPhoneTouchTargets(page);
    await attachReleaseStateArtifacts({ page, testInfo, prefix: "j1", state: "empty" });
    await broaderLink.press("Enter");
    await expect(page).toHaveURL(/\/search\?.*website=fresh-empty\.example.*broader=1/);
    const broaderUrl = new URL(page.url());
    expect(broaderUrl.searchParams.get("website")).toBe("fresh-empty.example");
    expect(broaderUrl.searchParams.get("query")).toBe("fresh-empty.example");
    expect(broaderUrl.searchParams.get("mode")).toBe("advertiser");
    expect(broaderUrl.searchParams.get("trackingRole")).toBe("competitor");
    expect(broaderUrl.searchParams.get("broader")).toBe("1");

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
    await attachReleaseStateArtifacts({ page, testInfo, prefix: "j1", state: "degraded" });

    // Recovery: a seeded cache result has explicit source/freshness copy.
    await searchWebsite.fill("nykaa.com");
    await expectMinimumTouchTarget(searchWebsite);
    await expectVisibleKeyboardFocus(searchWebsite);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/search\?.*website=nykaa\.com/);
    const result = page.getByRole("link", { name: /Nykaa.*Festive glow/i }).first();
    await expect(result).toBeVisible();
    await expectMinimumTouchTarget(result);
    await expectVisibleKeyboardFocus(result);
    const resultStatus = page.locator('[role="status"][aria-live="polite"]').filter({ hasText: /1 search result loaded/i });
    await expectStatusAnnouncement(resultStatus, "1 search result loaded. No more results. Search checks have recovered.");
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
    await expectPhoneTouchTargets(page);
    await expectNoHorizontalOverflow(page);
    await attachReleaseStateArtifacts({ page, testInfo, prefix: "j1", state: "proof" });

    // Value to signup: preserve the search context in the account handoff.
    const createAccount = page
      .locator(".f9-search-signup-cta")
      .getByRole("link", { name: "Create account" });
    await expect(createAccount).toBeVisible();
    await expectMinimumTouchTarget(createAccount);
    await expectVisibleKeyboardFocus(createAccount);
    const signupHref = await createAccount.getAttribute("href");
    expect(signupHref).toBeTruthy();
    const signupUrl = new URL(signupHref!, page.url());
    expect(signupUrl.pathname).toBe("/auth/signup");
    expect(signupUrl.searchParams.get("redirectTo")).toBe("/app?website=nykaa.com#setup-checklist");
    await createAccount.press("Enter");
    await expect(page).toHaveURL(/\/auth\/signup\?redirectTo=/);
    await expect(page.getByRole("heading", { name: "Verify your work email to start." })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
    const email = page.getByRole("textbox", { name: "Email" });
    await expectVisibleKeyboardFocus(email);
    const sendSetupLink = page.getByRole("button", { name: "Send setup link" });
    await expectMinimumTouchTarget(sendSetupLink);
    await expectPhoneTouchTargets(page);
    await expectNoHorizontalOverflow(page);
    const finalUrl = new URL(page.url());
    expect(finalUrl.searchParams.get("redirectTo")).toBe("/app?website=nykaa.com#setup-checklist");
    await attachReleaseStateArtifacts({ page, testInfo, prefix: "j1", state: "signup" });
    test.info().annotations.push({
      type: "finalUrl",
      description: `${finalUrl.pathname}${finalUrl.search}`,
    });
  });
}
