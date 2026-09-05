import { expect, test } from "@playwright/test";

type PublicControlTarget = {
  action: string;
  hashTargetExists: boolean;
  label: string;
  method: string;
  page: string;
  tag: string;
  target: string;
};

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function gotoPublicPage(page: import("@playwright/test").Page, path: string) {
  return page.goto(path, { waitUntil: "domcontentloaded" });
}

function isProductionBaseURL(baseURL: string | undefined) {
  return new URL(baseURL || "https://0509.io").hostname === "0509.io";
}

async function collectVisiblePublicControls(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    function isVisible(element: Element) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }

    function labelFor(element: Element) {
      return (
        element.getAttribute("aria-label") ||
        element.textContent?.replace(/\s+/g, " ").trim() ||
        element.getAttribute("value") ||
        element.getAttribute("placeholder") ||
        element.tagName.toLowerCase()
      ).slice(0, 120);
    }

    function hashTargetExists(url: URL) {
      if (!url.hash) return true;
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return true;
      const id = window.CSS?.escape ? CSS.escape(decodeURIComponent(url.hash.slice(1))) : decodeURIComponent(url.hash.slice(1));
      return Boolean(document.querySelector(`#${id}, a[name="${id}"]`));
    }

    const links = Array.from(document.querySelectorAll("a[href]"))
      .filter(isVisible)
      .map((element) => {
        const href = (element as HTMLAnchorElement).href;
        const url = new URL(href, window.location.href);
        return {
          action: "link",
          hashTargetExists: hashTargetExists(url),
          label: labelFor(element),
          method: "get",
          page: window.location.pathname + window.location.search,
          tag: element.tagName.toLowerCase(),
          target: href,
        };
      });

    const forms = Array.from(document.querySelectorAll("form"))
      .filter((form) => isVisible(form) || Boolean(form.querySelector("button,input,select,textarea")))
      .map((form) => {
        const submit = form.querySelector("button, input[type='submit']");
        const action = form.getAttribute("action") || window.location.pathname + window.location.search;
        return {
          action: "form",
          hashTargetExists: true,
          label: labelFor(submit || form),
          method: (form.getAttribute("method") || "get").toLowerCase(),
          page: window.location.pathname + window.location.search,
          tag: form.tagName.toLowerCase(),
          target: new URL(action, window.location.href).href,
        };
      });

    return [...links, ...forms] satisfies PublicControlTarget[];
  });
}

async function expectPublicGetTargetReachable(
  request: import("@playwright/test").APIRequestContext,
  baseURL: string | undefined,
  target: PublicControlTarget,
) {
  const url = new URL(target.target);
  if (!["http:", "https:"].includes(url.protocol)) return;
  if (url.origin !== new URL(baseURL || "https://0509.io").origin) return;

  const requestUrl = new URL(url);
  if (requestUrl.pathname === "/search" && requestUrl.searchParams.has("website")) {
    requestUrl.search = "";
  }

  const response = await request.get(requestUrl.toString(), { maxRedirects: 0, timeout: 5_000 });
  expect(response.status(), `${target.page} ${target.action} "${target.label}" -> ${requestUrl}`).not.toBe(404);
  expect(response.status(), `${target.page} ${target.action} "${target.label}" -> ${requestUrl}`).toBeLessThan(500);
}

async function mockPricingPreview(page: import("@playwright/test").Page) {
  await page.route("**/api/pricing-preview", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        available: true,
        country: "US",
        prices: {
          scout: {
            monthly: { display: "$19", amount: 1900, currency: "USD", billingCountry: "US" },
            yearly: { display: "$152", amount: 15200, currency: "USD", billingCountry: "US" },
          },
          starter: {
            monthly: { display: "$59", amount: 5900, currency: "USD", billingCountry: "US" },
            yearly: { display: "$472", amount: 47200, currency: "USD", billingCountry: "US" },
          },
          agency: {
            monthly: { display: "$199", amount: 19900, currency: "USD", billingCountry: "US" },
            yearly: { display: "$1,592", amount: 159200, currency: "USD", billingCountry: "US" },
          },
        },
        annualValidation: {
          scout: {
            valid: true,
            reason: "valid_4_months_free",
            monthlyAmount: 1900,
            annualAmount: 15200,
            expectedAnnualAmount: 15200,
            currency: "USD",
            billingCountry: "US",
          },
          starter: {
            valid: true,
            reason: "valid_4_months_free",
            monthlyAmount: 5900,
            annualAmount: 47200,
            expectedAnnualAmount: 47200,
            currency: "USD",
            billingCountry: "US",
          },
          agency: {
            valid: true,
            reason: "valid_4_months_free",
            monthlyAmount: 19900,
            annualAmount: 159200,
            expectedAnnualAmount: 159200,
            currency: "USD",
            billingCountry: "US",
          },
        },
      }),
    });
  });
}

function expectSignedOutPlanIntent(href: string | null, cycle: "monthly" | "yearly") {
  expect(href).toBeTruthy();
  const target = new URL(href!, "https://0509.io");
  expect(target.pathname).toBe("/auth/signup");
  const redirectTo = target.searchParams.get("redirectTo") ?? "";
  expect(redirectTo).toContain("/app/billing");
  expect(redirectTo).toContain(`cycle=${cycle}`);
  expect(redirectTo).toContain("source=pricing");
  expect(redirectTo).toContain("#plans");
}

test.describe("public production-safe E2E smoke", () => {
  test("public pages and machine-readable surfaces render without auth", async ({ page, baseURL, request }) => {
    await gotoPublicPage(page, "/");
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(page.getByText("Know when competitors change the offer.")).toBeVisible();
    await expect(page.getByText("WhatsApp", { exact: false })).toHaveCount(0);

    await gotoPublicPage(page, "/search");
    await expect(page.getByRole("heading", { name: "Find competitor ads" })).toBeVisible();

    if (!isProductionBaseURL(baseURL)) {
      await gotoPublicPage(page, "/auth/login");
      await expect(page.getByRole("heading", { name: "Return to the changes your team is watching." })).toBeVisible();

      await gotoPublicPage(page, "/auth/signup");
      await expect(page.getByRole("heading", { name: "Start with the competitor your team keeps checking by hand." })).toBeVisible();
    } else {
      for (const path of ["/auth/login", "/auth/signup"]) {
        const response = await request.get(new URL(path, baseURL).toString(), { maxRedirects: 0 });
        expect(response.status(), `${path} should not be missing`).not.toBe(404);
        expect(response.status(), `${path} should not hard-fail`).toBeLessThan(500);
      }
    }

    await gotoPublicPage(page, "/bots/presence");
    await expect(page.getByRole("heading", { name: "FiveToNinePresenceBot" })).toBeVisible();

    for (const path of ["/help", "/trust", "/privacy", "/terms", "/docs", "/changelog", "/api/docs"]) {
      const response = await gotoPublicPage(page, path);
      expect(response?.ok(), `${path} should return 2xx`).toBeTruthy();
      await expect(page.locator("body")).toBeVisible();
    }

    // Legacy public paths (pre-2026-07-20 rebuild) must redirect to the
    // homepage sections instead of 404 — see tests/public-routes-404.test.ts.
    // Follow the redirect so the final landing is a 200 and the anchor target
    // exists on the homepage.
    const legacyAnchorRedirects: Array<[string, string]> = [
      ["/sample-brief", "#demo"],
      ["/pricing", "#pricing"],
      ["/plans", "#pricing"],
    ];
    for (const [path, anchor] of legacyAnchorRedirects) {
      const response = await gotoPublicPage(page, path);
      expect(response?.status(), `${path} should redirect`).toBe(301);
      await expect(page).toHaveURL(new RegExp(`#${anchor.slice(1)}$`));
      await expect(page.locator(`#${anchor.slice(1)}`)).toBeVisible();
    }

    const health = await request.get(new URL("/api/health", baseURL).toString());
    expect(health.ok()).toBeTruthy();
    await expect(await health.json()).toMatchObject({ app: "0509", status: "ok" });

    const llms = await request.get(new URL("/llms.txt", baseURL).toString());
    expect(llms.ok()).toBeTruthy();
    expect(await llms.text()).toContain("Five to Nine");

    // AI crawler policy (docs/ai-crawler-policy.md, "answers yes, training
    // no"): training crawlers are denied while AI answer engines stay
    // allowed by the wildcard group — robots.txt and llms.txt must agree.
    const robots = await request.get(new URL("/robots.txt", baseURL).toString());
    expect(robots.ok()).toBeTruthy();
    const robotsText = await robots.text();
    expect(robotsText).toContain("User-agent: GPTBot");
    expect(robotsText).toContain("User-agent: ClaudeBot");
    expect(robotsText).toContain("User-agent: Google-Extended");
    expect(robotsText).toContain("Disallow: /");
    expect(robotsText).not.toContain("User-agent: PerplexityBot");
    expect(robotsText).not.toContain("User-agent: OAI-SearchBot");

    const invalidShare = await gotoPublicPage(page, "/share/not-a-real-share-token");
    expect(invalidShare?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "This share link isn't available" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "The link may have expired or been switched off by whoever shared it. Ask them for a fresh link.",
      ),
    ).toBeVisible();
  });

  test("public links never point at a same-origin 404", async ({ page, request, baseURL }) => {
    test.setTimeout(90_000);
    const publicPaths = [
      "/",
      "/search",
      "/compare/magicbrief",
      "/compare/meta-ad-library",
      "/help",
      "/docs",
      "/api/docs",
      "/status",
      "/changelog",
      "/trust",
      "/privacy",
      "/terms",
      "/bots/presence",
      "/sample-brief",
      "/pricing",
      "/plans",
    ];
    const failures: string[] = [];

    for (const path of publicPaths) {
      const response = await request.get(new URL(path, baseURL).toString(), {
        maxRedirects: 0,
        timeout: 10_000,
      });
      if (response.status() === 404) {
        failures.push(`${path} returned 404`);
      }
    }

    // Crawl every visible same-origin link on the public surfaces and record
    // any that 404 (sol-sweep packet
    // product-live/0509-sample-brief-and-pricing-public-routes-404). Hash
    // links are resolved against the homepage which hosts all current anchors.
    for (const path of publicPaths) {
      await gotoPublicPage(page, path);
      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).map(
          (element) => element.href,
        ),
      );
      for (const href of links) {
        const url = new URL(href, baseURL);
        if (url.origin !== new URL(baseURL || "https://0509.io").origin) continue;
        if (url.protocol !== "http:" && url.protocol !== "https:") continue;
        const pathname = url.pathname.replace(/\/+$/, "") || "/";
        const response = await request.get(new URL(pathname, baseURL).toString(), {
          maxRedirects: 0,
          timeout: 10_000,
        });
        if (response.status() === 404) {
          failures.push(`${path} links to 404: ${href}`);
        }
      }
      // Hash links resolve to the homepage section when the href is only an
      // anchor. Verify those anchor targets exist on the homepage.
      const hashTargets = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')).map(
          (element) => element.getAttribute("href")!.slice(1),
        ),
      );
      for (const target of hashTargets) {
        await gotoPublicPage(page, "/");
        await expect(page.locator(`#${target}`)).toBeVisible();
      }
    }

    expect(failures).toEqual([]);
  });

  test("public search stays usable at tablet and mobile widths", async ({ page }) => {
    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 760, height: 900 },
      { width: 375, height: 812 },
    ]) {
      await page.setViewportSize(viewport);
      await gotoPublicPage(page, "/search");
      await expect(page.getByRole("heading", { name: "Find competitor ads" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  });

  test("first-value journey shows a verified proof and preserves signup intent", async ({ page, baseURL }) => {
    test.skip(
      isProductionBaseURL(baseURL),
      "Branch search fixtures are local-only; production proof uses the authorized live canary gate.",
    );

    await page.setViewportSize({ width: 375, height: 812 });
    await gotoPublicPage(page, "/");
    const heroSearch = page.getByRole("form", { name: "Free live search" });
    await expect(heroSearch).toBeVisible();
    const heroRect = await heroSearch.boundingBox();
    expect(heroRect?.y).toBeLessThan(812);

    await gotoPublicPage(page, "/search?website=nykaa.com");
    await expect(page.getByRole("heading", { name: "1 verified ad linked to nykaa.com" })).toBeVisible();
    await expect(page.getByText("Source: Meta Ad Library visual check").first()).toBeVisible();
    await expect(
      page.locator("#selected-proof").getByRole("heading", { name: "Nykaa summer beauty event" }),
    ).toBeVisible();
    await expect(page.getByText("Landing page not captured yet").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // BL-031: the evidence is a peek pane beside the results list, not a
    // summary card stacked above it, so "the proof is reachable without
    // hunting" is checked as reachability rather than as "y is smaller".
    const selectedProof = page.locator("#selected-proof");
    await expect(selectedProof).toBeVisible();
    await expect(selectedProof).toBeInViewport();

    await page.locator(".f9-wk-row .f9-wk-rowlink").first().click();
    await expect(selectedProof).toBeFocused();
    await expect(selectedProof).toBeInViewport();

    const signup = page.getByRole("link", { name: "Create account" }).last();
    const signupTarget = new URL((await signup.getAttribute("href"))!, baseURL);
    expect(signupTarget.pathname).toBe("/auth/signup");
    expect(signupTarget.searchParams.get("redirectTo")).toContain("/app?");
    expect(signupTarget.searchParams.get("redirectTo")).toContain("#setup-checklist");
    expect(signupTarget.searchParams.get("redirectTo")).toContain("website=nykaa.com");

    for (const viewport of [
      { width: 768, height: 900 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await gotoPublicPage(page, "/search?website=nykaa.com");
      await expect(page.locator("#selected-proof")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }

    await gotoPublicPage(page, "/signup?email=owner%40example.com");
    await expect(page).toHaveURL(/\/auth\/signup\?email=/);
    await expect(page.getByLabel("Email")).toHaveValue("owner@example.com");
    await expect(page.getByLabel("Company or agency")).toHaveCount(0);
  });

  test("public pricing preserves monthly and annual plan intent for signed-out buyers", async ({ page, baseURL }) => {
    test.skip(
      isProductionBaseURL(baseURL),
      "Branch pricing-intent UI is verified in preview before deploy, then covered by canaries after deploy.",
    );
    await mockPricingPreview(page);
    await gotoPublicPage(page, "/");

    const monthlyPlanLink = page.getByRole("link", { name: "Choose monthly" }).first();
    if ((await monthlyPlanLink.count()) === 0) {
      // Local preview intentionally has no provider credentials. In that state
      // checkout must remain closed rather than manufacturing plan intent.
      await expect(page.getByRole("button", { name: "Annual" })).toBeDisabled();
      await expect(page.getByRole("link", { name: "Create account" }).last()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      return;
    }

    await expect(monthlyPlanLink).toBeVisible();
    expectSignedOutPlanIntent(await monthlyPlanLink.getAttribute("href"), "monthly");

    await page.getByRole("button", { name: "Annual" }).click();
    await expect(page.getByRole("link", { name: "Choose annual" }).first()).toBeVisible();
    expectSignedOutPlanIntent(
      await page.getByRole("link", { name: "Choose annual" }).first().getAttribute("href"),
      "yearly",
    );
    await expectNoHorizontalOverflow(page);
  });

  test("public buttons and links route to valid actions without sending side effects", async ({ page, baseURL, request }) => {
    test.setTimeout(60_000);
    const publicPaths = [
      "/",
      "/search",
      "/compare/magicbrief",
      "/help",
      "/docs",
      "/api/docs",
      "/status",
      "/changelog",
      "/trust",
      "/privacy",
      "/terms",
      "/bots/presence",
    ];
    if (!isProductionBaseURL(baseURL)) {
      publicPaths.push("/auth/login?redirectTo=%2Fapp", "/auth/signup");
    }
    const failures: string[] = [];
    const getTargets = new Map<string, PublicControlTarget>();

    for (const path of publicPaths) {
      await gotoPublicPage(page, path);
      const controls = await collectVisiblePublicControls(page);

      for (const control of controls) {
        const url = new URL(control.target);
        if (["mailto:", "tel:"].includes(url.protocol)) continue;

        if (!control.hashTargetExists) {
          failures.push(`${control.page} ${control.action} "${control.label}" points at missing hash ${url.hash}`);
          continue;
        }

        if (control.action === "form" && control.method !== "get") {
          expect(control.target, `${control.page} form "${control.label}" should have an action`).toBeTruthy();
          continue;
        }

        getTargets.set(new URL(control.target).toString(), control);
      }
    }

    for (const control of getTargets.values()) {
      await expectPublicGetTargetReachable(request, baseURL, control);
    }

    expect(failures).toEqual([]);
  });

  test("auth action buttons preserve redirects and block empty required submissions", async ({ page, baseURL }) => {
    test.skip(isProductionBaseURL(baseURL), "Live auth pages are rate-limited; covered in preview-public.");
    await gotoPublicPage(page, "/auth/login?redirectTo=%2Fapp");
    await expect(page.getByRole("heading", { name: "Get a secure sign-in link." })).toBeVisible();
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(page).toHaveURL(/\/auth\/login\?redirectTo=%2Fapp/);
    await expect(
      await page.getByLabel("Email").evaluate((element) => (element as HTMLInputElement).validity.valueMissing),
    ).toBe(true);

    await page.getByRole("link", { name: "Create one" }).click();
    await expect(page).toHaveURL(/\/auth\/signup\?redirectTo=%2Fapp/);
    await expect(page.getByRole("heading", { name: "Verify your work email to start." })).toBeVisible();
    await page.getByRole("button", { name: "Send setup link" }).click();
    await expect(page).toHaveURL(/\/auth\/signup\?redirectTo=%2Fapp/);
    await expect(
      await page.getByLabel("Name").evaluate((element) => (element as HTMLInputElement).validity.valueMissing),
    ).toBe(true);
    await expect(
      await page.getByLabel("Email").evaluate((element) => (element as HTMLInputElement).validity.valueMissing),
    ).toBe(true);

    await page.getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/auth\/login\?redirectTo=%2Fapp/);
  });
});
