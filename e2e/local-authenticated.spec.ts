import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const fixtureCookie = "f9_e2e_fixture";
const fixtureModeHeader = "x-0509-e2e-test-mode";
const clientSideButtonLabels = new Set(["Copy link", "Copied!", "Download PDF", "Try again", "+ Add competitor"]);

type VisibleActionControl = {
  buttonType: string;
  disabled: boolean;
  formAction: string;
  formMethod: string;
  hasForm: boolean;
  href: string;
  label: string;
  page: string;
  tag: string;
};

async function signInAs(context: BrowserContext, baseURL: string, userId: string) {
  const url = baseURL || "http://127.0.0.1:4179";

  await context.setExtraHTTPHeaders({ [fixtureModeHeader]: "1" });
  await context.addCookies([
    {
      name: fixtureCookie,
      value: userId,
      url,
      sameSite: "Lax",
    },
  ]);
}

async function expectAppPage(page: Page) {
  await expect(page).not.toHaveURL(/\/auth\/login/);
  await expect(page.getByRole("link", { name: "Overview" }).first()).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectNoFixedAppChrome(page: Page) {
  const fixedChrome = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".f9-dash-mobile-nav, .f9-dash-mobile-utility"))
      .map((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return {
          display: style.display,
          height: Math.round(rect.height),
          position: style.position,
          width: Math.round(rect.width),
        };
      })
      .filter((item) => item.display !== "none" && item.width > 0 && item.height > 0 && item.position === "fixed"),
  );
  expect(fixedChrome).toEqual([]);
}

async function expectCompactHeaderActions(page: Page) {
  // The topbar ships one "Overview" link plus the "+ Add competitor" quick-add
  // button (a real <button>, not a link — it opens the palette dialog).
  const actions = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".f9-dash-topbar a, .f9-dash-topbar button")).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        height: Math.round(rect.height),
        tag: element.tagName.toLowerCase(),
        text: element.textContent?.trim() ?? "",
        width: Math.round(rect.width),
      };
    }),
  );

  expect(actions).toEqual([
    expect.objectContaining({ tag: "a", text: "Overview" }),
    expect.objectContaining({ tag: "button", text: "+ Add competitor" }),
  ]);
  for (const action of actions) {
    expect(action.height).toBeGreaterThanOrEqual(32);
    expect(action.height).toBeLessThanOrEqual(48);
    expect(action.width).toBeLessThanOrEqual(180);
  }
}

async function expectMobileUtilityInViewport(page: Page) {
  const utilityActions = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".f9-dash-mobile-utility a, .f9-dash-mobile-utility button")).map(
      (element) => {
        const rect = element.getBoundingClientRect();
        return {
          bottom: Math.round(rect.bottom),
          text: element.textContent?.trim() ?? "",
          top: Math.round(rect.top),
        };
      },
    ),
  );

  // Shipped utility rail: Team, Client rooms, Support, Billing (+ Sign out button).
  for (const text of ["Team", "Client rooms", "Support", "Billing", "Sign out"]) {
    expect(utilityActions).toContainEqual(expect.objectContaining({ text }));
    const action = utilityActions.find((item) => item.text === text);
    expect(action?.top).toBeGreaterThanOrEqual(0);
    expect(action?.bottom).toBeLessThanOrEqual(page.viewportSize()!.height);
  }
}

async function expectMobileNavLinksInContainer(page: Page) {
  // The mobile primary nav is a horizontal swipe rail ("Swipe for more"), so
  // links past the fold legitimately sit outside the visible rect. Every link
  // must stay inside the rail's scrollable content, stay vertically unclipped,
  // and the rail must actually scroll so the last link is reachable.
  const issues = await page.evaluate(() => {
    const nav = document.querySelector(".f9-dash-mobile-nav");
    if (!nav) {
      return ["missing mobile nav"];
    }

    const problems: string[] = [];
    const style = window.getComputedStyle(nav);
    if (nav.scrollWidth > nav.clientWidth + 1 && !["auto", "scroll"].includes(style.overflowX)) {
      problems.push("mobile nav overflows without horizontal scrolling");
    }

    const navRect = nav.getBoundingClientRect();
    for (const element of Array.from(nav.querySelectorAll("a"))) {
      const rect = element.getBoundingClientRect();
      const text = element.textContent?.trim() ?? "";
      if (rect.top < navRect.top || rect.bottom > navRect.bottom) {
        problems.push(`${text} is vertically clipped`);
      }
      const contentLeft = rect.left - navRect.left + nav.scrollLeft;
      if (contentLeft < -1 || contentLeft + rect.width > nav.scrollWidth + 1) {
        problems.push(`${text} sits outside the scrollable rail`);
      }
    }

    const links = Array.from(nav.querySelectorAll("a"));
    const last = links.at(-1);
    if (last) {
      const previousScrollLeft = nav.scrollLeft;
      nav.scrollLeft = nav.scrollWidth;
      const railRect = nav.getBoundingClientRect();
      const lastRect = last.getBoundingClientRect();
      if (lastRect.left < railRect.left - 1 || lastRect.right > railRect.right + 1) {
        problems.push(`${last.textContent?.trim() ?? "last link"} is not reachable by scrolling the rail`);
      }
      nav.scrollLeft = previousScrollLeft;
    }

    return problems;
  });

  expect(issues).toEqual([]);
}

async function collectVisibleActionControls(page: Page) {
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

    return Array.from(document.querySelectorAll("a[href], button"))
      .filter(isVisible)
      .map((element) => {
        const form = element.closest("form");
        const tag = element.tagName.toLowerCase();
        return {
          buttonType: tag === "button" ? ((element as HTMLButtonElement).type || "submit").toLowerCase() : "",
          disabled: (element as HTMLButtonElement).disabled || element.hasAttribute("aria-disabled"),
          formAction: form ? new URL(form.getAttribute("action") || window.location.pathname + window.location.search, window.location.href).href : "",
          formMethod: form?.getAttribute("method")?.toLowerCase() || "get",
          hasForm: Boolean(form),
          href: tag === "a" ? (element as HTMLAnchorElement).href : "",
          label: labelFor(element),
          page: window.location.pathname + window.location.search,
          tag,
        };
      }) satisfies VisibleActionControl[];
  });
}

async function expectAppActionControlsWired(page: Page) {
  const controls = await collectVisibleActionControls(page);
  const currentOrigin = new URL(page.url()).origin;
  const issues: string[] = [];

  for (const control of controls) {
    if (!control.label) {
      issues.push(`${control.page} has an unlabeled visible ${control.tag}`);
      continue;
    }

    if (control.tag === "a") {
      const url = new URL(control.href);
      if (["mailto:", "tel:"].includes(url.protocol)) continue;
      if (url.origin !== currentOrigin) continue;

      const response = await page.request.get(url.toString());
      if (response.status() === 404 || response.status() >= 500) {
        issues.push(`${control.page} link "${control.label}" points to ${url} with ${response.status()}`);
      }
      continue;
    }

    if (control.tag !== "button" || control.disabled) continue;

    if (control.buttonType === "submit") {
      if (!control.hasForm) {
        issues.push(`${control.page} submit button "${control.label}" is not inside a form`);
      }
      if (!["get", "post"].includes(control.formMethod)) {
        issues.push(`${control.page} submit button "${control.label}" uses unsupported method ${control.formMethod}`);
      }
      if (!control.formAction) {
        issues.push(`${control.page} submit button "${control.label}" has no form action`);
      }
      continue;
    }

    if (control.buttonType === "button") {
      if (!clientSideButtonLabels.has(control.label)) {
        issues.push(`${control.page} client button "${control.label}" needs explicit E2E allowlisting`);
      }
      continue;
    }

    issues.push(`${control.page} button "${control.label}" has unsupported type ${control.buttonType}`);
  }

  expect(issues).toEqual([]);
}

test.describe("local authenticated E2E harness", () => {
  test("new customer sees setup inside Overview without magic-link login", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, "e2e-free");
    await page.goto("/app");

    await expect(page).toHaveURL(/\/app/);
    await expect(page.getByRole("heading", { name: "Finish the workspace that sends your first brief" })).toBeVisible();
    await expect(
      page.getByText("Paste one competitor website to start."),
    ).toBeVisible();
    await expect(page.getByText("We create the watchlist and start its first scan immediately.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Track this competitor" })).toBeDisabled();
    await expectNoHorizontalOverflow(page);
  });

  test("new starter completes one-competitor onboarding and reaches the queued watchlist", async ({
    page,
    context,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signInAs(context, baseURL!, "e2e-activation");
    await page.goto("/app?website=nykaa.com#setup-checklist");

    await expect(page.getByLabel("Competitor website")).toHaveValue("nykaa.com");
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "Track Nykaa" }).focus();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/app\/watchlists\?watchlist=/);
    await expect(page.getByRole("heading", { name: "Competitors" })).toBeVisible();
    await expect(page.getByText("Nykaa watch").first()).toBeVisible();
  });

  test("starter customer journey covers dashboard, search, watchlists, presence, digests, billing, developer, support, and account", async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAs(context, baseURL!, "e2e-starter");

    await page.goto("/app");
    await expectAppPage(page);
    await expect(page.locator("#f9-main-content").getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.locator("#f9-main-content").getByText("Latest stored changes", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Okara competitor watch")).toBeVisible();

    await page.goto("/search");
    await expect(page.getByRole("heading", { name: "Find competitor ads" })).toBeVisible();

    await page.goto("/app/watchlists");
    await expectAppPage(page);
    await expect(
      page.locator("#f9-main-content").getByRole("heading", { level: 1, name: "Competitors", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Okara competitor watch").first()).toBeVisible();

    // Presence is rollout-gated off in the E2E harness (wrangler.e2e.jsonc sets
    // PRESENCE_WEBSITE_ROLLOUT: "disabled"), so a direct visit bounces to /app
    // and the sidebar hides the Presence link instead of rendering the desk.
    await page.goto("/app/presence");
    await expect(page).toHaveURL((url) => url.pathname === "/app");
    await expectAppPage(page);
    await expect(page.locator("#f9-main-content").getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.locator("#f9-main-content").getByText("Latest stored changes", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Presence" })).toHaveCount(0);

    await page.goto("/app/digests");
    await expectAppPage(page);
    await expect(
      page.locator("#f9-main-content").getByRole("heading", { level: 1, name: "Briefs", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("#f9-main-content").getByText(
        "Read each period as one brief: the finding, the captured changes, the quiet checks, and the facts behind it.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.locator("#f9-main-content").getByText("Landing page offer changed", { exact: true }),
    ).toBeVisible();

    await page.goto("/app/billing");
    await expectAppPage(page);
    await expect(page.getByRole("heading", { name: "Billing & usage" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Starter plan" })).toBeVisible();
    await expect(page.getByText("purchased checks remaining")).toBeVisible();

    await page.goto("/app/source-access");
    await expectAppPage(page);
    await expect(page.getByRole("heading", { name: "Source access" })).toBeVisible();
    await expect(page.getByText("Backup Meta ad checks")).toBeVisible();

    await page.goto("/app/developer-access");
    await expectAppPage(page);
    await expect(page.getByRole("heading", { name: "Developer access" })).toBeVisible();
    await expect(page.getByText("Connect exports and approved actions")).toBeVisible();
    await expect(
      page.getByText("Developer access is included in the Agency plan. Upgrade to Agency to create API keys."),
    ).toBeVisible();
    await expect(page.getByLabel("Key name")).toBeDisabled();
    await expect(page.getByRole("button", { name: "API keys unavailable" })).toBeDisabled();

    await page.goto("/app/support");
    await expectAppPage(page);
    await expect(page.getByRole("heading", { name: "Help & support" })).toBeVisible();
    await expect(page.getByText("Fixture billing question")).toBeVisible();

    await page.goto("/app/account");
    await expectAppPage(page);
    await expect(page.getByRole("heading", { name: "Account & security" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "E2E Starter" })).toBeVisible();
    await expect(page.getByLabel("My brand website")).toHaveValue("https://starter.example.invalid");

    await page.goto("/app/notifications");
    await expect(page).toHaveURL(/\/app\/notifications/);
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();

    await page.goto("/app/team");
    await expectAppPage(page);
    await expect(
      page.locator("#f9-main-content").getByRole("heading", { level: 1, name: "Team", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("#f9-main-content").getByText(
        "Invite teammates to share watchlists, collections, and digests on Agency.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.locator("#f9-main-content")).toContainText("Invite your teammates");

    await page.goto("/app/sources");
    await expect(page).toHaveURL(/\/app\/sources/);
    await expect(page.getByRole("heading", { name: "Workspace settings" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open notifications" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open source access" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open developer access" })).toBeVisible();

    await page.goto("/app/reports");
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  });

  test("scout journey shows weekly cadence and gates starter or agency controls honestly", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, "e2e-scout");

    await page.goto("/app");
    await expectAppPage(page);
    await expect(page.getByText("Scout weekly watch")).toBeVisible();
    await expect(page.getByText("weekly", { exact: false })).toBeVisible();

    await page.goto("/app/digests");
    await expect(page.getByRole("heading", { name: "Briefs", exact: true })).toBeVisible();

    await page.goto("/app/developer-access");
    await expect(
      page.getByText("Developer access is included in the Agency plan. Upgrade to Agency to create API keys."),
    ).toBeVisible();
    await expect(page.getByLabel("Key name")).toBeDisabled();
    await expect(page.getByRole("button", { name: "API keys unavailable" })).toBeDisabled();
  });

  test("agency fixture exposes developer controls without enabling unavailable social delivery", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, "e2e-agency");

    await page.goto("/app/developer-access");
    await expectAppPage(page);
    await expect(page.getByRole("heading", { name: "Developer access" })).toBeVisible();
    await expect(page.getByText("Fixture read-only key")).toBeVisible();
    await expect(
      page.getByText("this does not add automated TikTok, Google, LinkedIn, or Pinterest ingestion"),
    ).toBeVisible();

    await page.goto("/app/reports/watchlist:e2e-watchlist-agency-1");
    await expectAppPage(page);
    // BL-009: the report opens on its cover, whose mono kicker names the
    // document and whose headline is the finding (brief §6.10).
    await expect(page.locator(".f9-ed-report-kicker")).toContainText(
      "Competitor evidence report",
    );
    await expect(page.locator("#f9-main-content").getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("agency sidebar navigation reaches every customer-facing section in screenshot order", async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAs(context, baseURL!, "e2e-agency");

    const routes = [
      { label: "Overview", path: "/app", heading: null, copy: ["Latest stored changes"] },
      { label: "Search", path: "/search", heading: "Find competitor ads", copy: ["Competitor website", "See ads"] },
      {
        label: "Competitors",
        path: "/app/watchlists",
        heading: "Competitors",
        copy: ["Monitor competitor ads over time"],
      },
      {
        label: "Collections",
        path: "/app/collections",
        heading: "Collections",
        copy: ["Save the best competitor examples", "Create collection"],
      },
      { label: "Briefs", path: "/app/digests", heading: "Briefs", copy: ["Brief history"] },
      {
        label: "Reports",
        path: "/app/reports",
        heading: "Reports",
        copy: ["Open a current proof-backed report"],
      },
      {
        label: "Shared links",
        path: "/app/shares",
        heading: "Shared links",
        copy: ["Review and revoke snapshot or live-view links", "Anyone with a link can open"],
      },
      {
        label: "Notifications",
        path: "/app/notifications",
        heading: "Notifications",
        copy: ["Digest and alert delivery"],
      },
      {
        label: "Source access",
        path: "/app/source-access",
        heading: "Source access",
        copy: ["Backup Meta ad checks"],
      },
      {
        label: "Developer access",
        path: "/app/developer-access",
        heading: "Developer access",
        copy: ["Connect exports and approved actions"],
      },
      { label: "Team", path: "/app/team", heading: "Team", copy: ["Agency seats in use"] },
      {
        label: "Client rooms",
        path: "/app/clients",
        heading: "Client rooms",
        copy: ["Package evidence and reports"],
      },
      {
        label: "Billing & usage",
        path: "/app/billing",
        heading: "Billing & usage",
        copy: ["Current plan"],
      },
      {
        label: "Account & security",
        path: "/app/account",
        heading: "Account & security",
        copy: ["Signed in as"],
      },
      {
        label: "Help & support",
        path: "/app/support",
        heading: "Help & support",
        copy: ["Tell us what needs attention"],
      },
    ];
    const bannedCustomerCopy = [
      /Something went wrong/i,
      /Application Error/i,
      /stack trace/i,
      /SQLITE_/i,
      /D1_ERROR/i,
      /Cannot read properties/i,
      /undefined is not/i,
      /\bStripe\b/i,
      /0509\.in(?!valid)/i,
      /Stytch/i,
    ];

    await page.goto("/app");
    for (const route of routes) {
      const link = page.locator(".f9-cursor-rail").getByRole("link", { name: route.label, exact: true }).first();
      await expect(link, `${route.label} sidebar link should be visible`).toBeVisible();

      if (new URL(page.url()).pathname !== route.path) {
        await Promise.all([
          page.waitForURL((url) => url.pathname === route.path),
          link.click(),
        ]);
      }

      await expect(page).toHaveURL((url) => url.pathname === route.path);
      await expectAppPage(page);
      const mainContent = page.locator("#f9-main-content");
      const pageHeading = mainContent.getByRole("heading", {
        level: 1,
        ...(route.heading ? { name: route.heading, exact: true } : {}),
      });
      await expect(pageHeading).toBeVisible();
      for (const text of route.copy) {
        await expect(mainContent).toContainText(text);
      }

      const bodyText = await page.locator("body").innerText();
      for (const pattern of bannedCustomerCopy) {
        expect(bodyText, `${route.label} should not expose stale/error copy matching ${pattern}`).not.toMatch(pattern);
      }
      await expectAppActionControlsWired(page);
    }
  });

  test("authenticated buttons and links are wired to real destinations or form actions", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, "e2e-agency");

    for (const route of [
      "/app",
      "/app/watchlists",
      "/app/notifications",
      "/app/source-access",
      "/app/developer-access",
      "/app/billing",
      "/app/digests",
      "/app/reports/watchlist:e2e-watchlist-agency-1",
      "/app/collections",
      "/app/clients",
      "/app/team",
      "/app/support",
      "/app/account",
    ]) {
      await page.goto(route);
      await expectAppPage(page);
      await expectAppActionControlsWired(page);
    }
  });

  test("sign out button posts logout and clears authenticated app access", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, "e2e-starter");

    await page.goto("/app");
    await expectAppPage(page);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.getByRole("heading", { name: "Get a secure sign-in link." })).toBeVisible();
    await page.goto("/app");
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("mobile dashboard navigation stays usable across target breakpoints", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, "e2e-starter");
    const viewports = [
      { width: 320, height: 700 },
      { width: 375, height: 812 },
      { width: 430, height: 932 },
      { width: 640, height: 900 },
      { width: 641, height: 900 },
      { width: 750, height: 900 },
      { width: 760, height: 900 },
      { width: 761, height: 900 },
      { width: 1024, height: 768 },
    ];
    const routes = [
      "/app",
      "/app/watchlists",
      "/app/sources",
      "/app/notifications",
      "/app/source-access",
      "/app/developer-access",
      "/app/billing",
      "/app/reports",
    ];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      for (const route of routes) {
        await page.goto(route);
        await expectAppPage(page);
        await expect(page.getByRole("link", { name: "Competitors" }).first()).toBeVisible();
        await expect(page.getByRole("link", { name: "Notifications" }).first()).toBeVisible();
        await expect(page.getByRole("button", { name: "Sign out" }).first()).toBeVisible();
        await expectNoFixedAppChrome(page);
        await expectCompactHeaderActions(page);
        if (viewport.width <= 640) {
          await expect(page.getByRole("link", { name: "Developer access" }).first()).toBeVisible();
          await expectMobileNavLinksInContainer(page);
          await expectMobileUtilityInViewport(page);
        }
        await expectNoHorizontalOverflow(page);
      }
    }
  });

  test("billing cycle picker keeps monthly and annual intent accessible on small screens", async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAs(context, baseURL!, "e2e-free-onboarded");

    for (const viewport of [
      { width: 320, height: 700 },
      { width: 375, height: 812 },
      { width: 430, height: 932 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/app/billing?plan=starter&cycle=yearly&source=e2e#plans");
      await expectAppPage(page);
      await expect(page.getByRole("heading", { name: "Billing & usage" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Annual" })).toHaveAttribute("aria-current", "true");
      await expect(page.getByRole("link", { name: "Monthly" })).not.toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("link", { name: "Monthly" })).toHaveAttribute(
        "href",
        /plan=starter.*cycle=monthly.*source=e2e/,
      );
      await expectNoHorizontalOverflow(page);
    }
  });

  test("error and permission states are customer-safe", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, "e2e-agency");

    await page.goto("/app/reports/watchlist:missing-fixture");
    await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
    await expect(page.getByText("This page or item is no longer available.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Contact support" })).toBeVisible();
    await expect(page.getByText("stack", { exact: false })).toHaveCount(0);
    await expect(page.getByText("D1", { exact: false })).toHaveCount(0);

    await signInAs(context, baseURL!, "e2e-free-onboarded");
    await page.goto("/app/digests");
    await expect(page).toHaveURL(/\/app\/digests/);
    // Free Weekly Competitor Watch: free plans now get the (empty) Briefs
    // surface instead of a paid gate.
    await expect(page.getByRole("heading", { name: "Briefs", exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Your first brief lands after the first scan" }).first(),
    ).toBeVisible();
  });
});
