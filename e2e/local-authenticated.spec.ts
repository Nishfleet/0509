import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const fixtureCookie = "f9_e2e_fixture";
const fixtureModeHeader = "x-0509-e2e-test-mode";
const clientSideButtonLabels = new Set([
  "Copy link",
  "Copied!",
  "Download PDF",
  "Try again",
  // BL-030 rail + rebuilt surfaces: the visible ⌘K affordance, the
  // "Workspace & account" disclosure, and the Competitors page action, which
  // opens the same quick-add dialog rather than navigating.
  "Search…⌘K",
  "Add competitor",
  // /app/clients header action: opens the in-page create-room composer
  // for agency accounts (BL-042). It is a client-side toggle, not a form
  // submission, so it must be on the allowlist to pass the wired-actions
  // audit at e2e/local-authenticated.spec.ts:680.
  "Create client room",
]);

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
  await expect(page.getByRole("link", { name: "Today" }).first()).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectNoFixedAppChrome(page: Page) {
  const fixedChrome = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        ".f9-dash-mobile-nav, .f9-dash-mobile-utility",
      ),
    )
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

// Routes whose single primary is conditional (it can legitimately be absent —
// e.g. Billing renders "Current plan" rather than an ink CTA on the plan you
// are already on) still may never carry a second one, so they assert the §5
// ceiling instead of an exact count. BL-042 adds the surfaces that BL-033a/b,
// BL-034 and BL-037..BL-039 rebuilt but never registered anywhere: they were
// silently exercising the old topbar branch below until the bar was deleted.
const conditionalPrimaryRoutes = new Set([
  "/app/clients",
  "/app/collections",
  "/app/digests",
  "/app/notifications",
  "/app/presence",
  "/app/reports",
  "/app/shares",
  "/app/source-access",
  "/app/developer-access",
  "/app/team",
  "/app/billing",
  "/app/account",
]);
// Surfaces rebuilt in the landing language: they own their whole page, header
// included, and carry their single action in the working header.
const workingHeaderRoutes = new Set([
  "/app",
  "/app/watchlists",
  "/app/deliver",
  "/app/settings",
  ...conditionalPrimaryRoutes,
]);

async function expectNoShellActionRow(page: Page) {
  // BL-042: actions belong to the route's working header. The shell-owned
  // action row is deleted outright, so the old boxed "Overview / + Add
  // competitor" twin must not appear above ANY page — this is the universal
  // form of the per-route suppression BL-030/BL-040/BL-041 grew one entry at a
  // time (and kept forgetting to grow).
  await expect(page.locator(".f9-dash-topbar")).toHaveCount(0);

  // Brief §5 — exactly one ink-filled primary per screen. BL-030 asserted this
  // only on the routes it had rebuilt, because elsewhere the shell's own ink
  // primary was the screen's one primary. With the shell bar gone the ceiling
  // is purely a page property, so it is asserted on every route instead.
  const pathname = new URL(page.url()).pathname;

  if (!workingHeaderRoutes.has(pathname)) {
    // Still on the pre-landing-language DashboardPage system (the /app/sources
    // settings signpost, Help & support, Ops, presence detail). They ship no
    // working header at all, and a pure signpost legitimately carries no
    // primary — but it may never carry two.
    await expect(page.locator(".f9-wk-head")).toHaveCount(0);
    expect(await page.locator(".f9-wk-btn:visible").count()).toBeLessThanOrEqual(1);
    return;
  }

  await expect(page.locator(".f9-wk-head")).toHaveCount(1);
  const filledButtonCount = await page.locator(".f9-wk-page .f9-wk-btn").count();
  if (conditionalPrimaryRoutes.has(pathname)) {
    expect(filledButtonCount).toBeLessThanOrEqual(1);
  } else {
    expect(filledButtonCount).toBe(1);
  }
}

async function expectMobileSettingsRoutesReachable(page: Page) {
  // PR-5a collapsed the mobile nav to the 5 primary destinations plus the
  // session action. The strip is the customer's only nav affordance at
  // small viewports, so every primary destination plus "Sign out" must
  // still render, and must render inside the viewport vertically (the rail
  // scrolls horizontally, not vertically). The settings routes that used
  // to be peer rows (Delivery, Source access, Developer access, Team,
  // Billing & usage, Account & security, Help & support) live one
  // disclosure in, behind "Settings"; reachability of those pages is
  // covered by the agency sidebar walk above, not by this strip check.
  const navActions = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".f9-dash-mobile-nav a, .f9-dash-mobile-nav button")).map(
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

  const viewportHeight = page.viewportSize()!.height;
  for (const text of ["Today", "Watch", "Library", "Deliver", "Settings", "Sign out"]) {
    expect(navActions).toContainEqual(expect.objectContaining({ text }));
    const action = navActions.find((item) => item.text === text);
    expect(action?.top).toBeGreaterThanOrEqual(0);
    expect(action?.bottom).toBeLessThanOrEqual(viewportHeight);
  }
}

async function expectMobileNavLinksInContainer(page: Page) {
  // The mobile primary nav is a quiet horizontally scrolling text row. Links
  // past the fold legitimately sit outside the visible rect; no instructional
  // copy is needed. Every route must remain reachable inside the row.
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
    for (const element of Array.from(nav.querySelectorAll("a, button"))) {
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

    const controls = Array.from(nav.querySelectorAll("a, button"));
    const last = controls.at(-1);
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

async function expectAppActionControlsWired(page: Page, checkedUrls: Set<string> = new Set()) {
  const controls = await collectVisibleActionControls(page);
  const currentOrigin = new URL(page.url()).origin;
  const issues: string[] = [];
  // The agency sidebar walk fans out 90+ same-origin GETs per run.
  // A sequential walk on the local dev server was exceeding the 30s
  // per-test budget. We run the same HTTP checks in parallel with a
  // per-request cap, and cache URLs across pages so each unique
  // destination is checked exactly once. A 404 or 5xx is still a
  // failure; a timeout or network error is reported as a broken link.
  type LinkResult = {
    ok: boolean;
    status: number;
    target: string;
    label: string;
    pageLabel: string;
    error?: string;
  };
  const linkThunks: Array<() => Promise<LinkResult>> = [];
  const linkRequestTimeout = 5_000;

  for (const control of controls) {
    if (!control.label) {
      issues.push(`${control.page} has an unlabeled visible ${control.tag}`);
      continue;
    }

    if (control.tag === "a") {
      const url = new URL(control.href);
      if (["mailto:", "tel:"].includes(url.protocol)) continue;
      if (url.origin !== currentOrigin) continue;

      const target = url.toString();
      if (checkedUrls.has(target)) continue;
      checkedUrls.add(target);

      const label = control.label;
      const pageLabel = control.page;
      linkThunks.push(() =>
        page.request
          .get(target, { timeout: linkRequestTimeout })
          .then<LinkResult>((response) => ({
            ok: response.status() !== 404 && response.status() < 500,
            status: response.status(),
            target,
            label,
            pageLabel,
          }))
          .catch((error: unknown) => ({
            ok: false,
            status: 0,
            target,
            label,
            pageLabel,
            error: error instanceof Error ? error.message : String(error),
          })),
      );
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

  // Run the link checks in bounded concurrency so one slow compile does
  // not starve the others, while still failing if a link is broken or
  // does not respond in time.
  const concurrency = 15;
  for (let i = 0; i < linkThunks.length; i += concurrency) {
    const batch = linkThunks.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((fn) => fn()));
    for (const result of results) {
      if (!result.ok) {
        const detail = result.error ? ` (${result.error})` : ` with ${result.status}`;
        issues.push(`${result.pageLabel} link "${result.label}" points to ${result.target}${detail}`);
      }
    }
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
    await expect(
      page.getByRole("heading", { level: 1, name: "Nykaa watch", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".f9-wk-context")).toContainText("Nykaa");
    await expect(page.locator(".f9-watchdetail-detail")).toBeVisible();
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
    // BL-030: the Overview's kickers are Overnight / What changed / Still
    // running, and the watched competitors themselves live on /app/watchlists.
    await expect(
      page.locator("#f9-main-content").getByText("Overnight", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("#f9-main-content").getByText("What changed", { exact: true }),
    ).toBeVisible();

    await page.goto("/search");
    await expect(page.getByRole("heading", { name: "Find competitor ads" })).toBeVisible();

    await page.goto("/app/watchlists");
    await expectAppPage(page);
    await expect(
      page.locator("#f9-main-content").getByRole("heading", { level: 1, name: "Watch", exact: true }),
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
      page.locator("#f9-main-content").getByText("Overnight", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Presence" })).toHaveCount(0);

    await page.goto("/app/digests");
    await expectAppPage(page);
    await expect(
      page.locator("#f9-main-content").getByRole("heading", { level: 1, name: "Briefs", exact: true }),
    ).toBeVisible();
    // The header copy is pluralised: "Showing 2 recent briefs on file." The
    // e2e-starter fixture files two briefs, so the plural form is what
    // actually ships. Match the shipped copy rather than the singular.
    await expect(page.locator("#f9-main-content")).toContainText("briefs on file");
    await expect(
      page
        .locator("#f9-main-content")
        .getByRole("heading", { level: 2, name: "Landing page offer changed", exact: true }),
    ).toBeVisible();

    await page.goto("/app/billing");
    await expectAppPage(page);
    await expect(page.getByRole("heading", { name: "Billing & usage" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Starter plan" })).toBeVisible();
    await expect(page.getByText("purchased proof captures remaining")).toBeVisible();

    await page.goto("/app/source-access");
    await expectAppPage(page);
    await expect(page.getByRole("heading", { name: "Source access" })).toBeVisible();
    await expect(page.getByText("Backup Meta ad checks")).toBeVisible();

    await page.goto("/app/developer-access");
    await expectAppPage(page);
    // The route renders BOTH an h1 ("Developer access") and, for non-Agency
    // accounts, an h2 ("Developer access is on Agency"). Strict mode would
    // resolve two headings for the substring "Developer access"; assert the
    // h1 explicitly so the gate fails if the h1 disappears rather than
    // silently matching the lock section.
    await expect(
      page.getByRole("heading", { name: "Developer access", exact: true, level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("Connect exports and approved actions")).toBeVisible();
    await expect(
      page.getByText("Developer access is included in the Agency plan. Upgrade to Agency to create API keys."),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Developer access is on Agency" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Upgrade to Agency" })).toBeVisible();
    await expect(page.getByLabel("Key name")).toHaveCount(0);

    await page.goto("/app/support");
    await expectAppPage(page);
    await expect(page.getByRole("heading", { name: "Help & support" })).toBeVisible();
    await expect(page.getByText("Fixture billing question")).toBeVisible();

    await page.goto("/app/account");
    await expectAppPage(page);
    await expect(page.getByRole("heading", { name: "Account & security" })).toBeVisible();
    await expect(page.getByText(/Signed in as e2e-starter@example\.invalid/)).toBeVisible();
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
        "Team access is included with Agency.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.locator("#f9-main-content")).toContainText("Invite your teammates");

    // /app/sources is a 301 into Notifications (tri-audit S5); the legacy
    // hub page no longer exists.
    await page.goto("/app/sources");
    await expect(page).toHaveURL(/\/app\/notifications/);

    await page.goto("/app/reports");
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  });

  test("scout journey shows weekly cadence and gates starter or agency controls honestly", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, "e2e-scout");

    await page.goto("/app");
    await expectAppPage(page);
    // The Overview states the cadence as the next check it can actually
    // promise, not as an adjective; the competitor itself is named on its own
    // surface. Both are the honest homes for these two facts.
    await expect(page.locator("#f9-main-content")).toContainText("Next check");
    await page.goto("/app/watchlists");
    await expect(page.getByText("Scout weekly watch").first()).toBeVisible();

    await page.goto("/app/digests");
    await expect(page.getByRole("heading", { name: "Briefs", exact: true })).toBeVisible();

    await page.goto("/app/developer-access");
    await expect(
      page.getByText("Developer access is included in the Agency plan. Upgrade to Agency to create API keys."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Upgrade to Agency" })).toBeVisible();
    await expect(page.getByLabel("Key name")).toHaveCount(0);
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
    await expect(page.locator(".f9-evidence-report-kicker")).toContainText(
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

    const routes: Array<{ label: string; path: string; heading: string | null; copy: string[]; direct?: boolean }> = [
      { label: "Today", path: "/app", heading: null, copy: ["Overnight"] },
      {
        label: "Watch",
        path: "/app/watchlists",
        heading: "Watch",
        copy: ["changed in the last 30 days"],
      },
      {
        label: "Library",
        path: "/app/collections",
        heading: "Library",
        copy: ["Saved evidence stays attached", "Start your first collection"],
      },
      {
        label: "Deliver",
        path: "/app/deliver",
        heading: "Deliver",
        copy: ["Delivery surfaces", "Briefs"],
      },
      {
        label: "Settings",
        path: "/app/settings",
        heading: "Settings",
        copy: ["Account & security", "Billing & usage"],
      },
      // The agency fixture intentionally ships with zero filed briefs, so
      // /app/digests renders the empty state ("Your first brief lands after
      // the first scan") rather than the "Brief history" rail. The page
      // heading is the durable customer-visible contract for the route; the
      // empty-state copy is the second durable contract for this persona.
      { label: "Deliver", path: "/app/digests", heading: "Briefs", copy: ["Your first brief lands after the first scan"], direct: true },
      { label: "Today", path: "/search", heading: "Find competitor ads", copy: ["Competitor website", "See ads"], direct: true },
      {
        label: "Deliver",
        path: "/app/reports",
        heading: "Reports",
        copy: ["report"],
        direct: true,
      },
      {
        label: "Deliver",
        path: "/app/shares",
        heading: "Shared links",
        copy: ["No active share links", "expires or you revoke it"],
        direct: true,
      },
      {
        label: "Settings",
        direct: true,
        path: "/app/notifications",
        heading: "Notifications",
        // BL-039 rebuilt the notifications page as a set of definitions, not
        // a dashboard. The first ruled section heading is singular
        // ("Delivery channel"); the matching page copy is "Delivery channel:
        // email" at the foot of the page (the email-only summary the agency
        // fixture ships with). Match the shipped copy rather than the old
        // "Delivery channels" plural that pre-dated the rebuild.
        copy: ["Delivery channel: email"],
      },
      {
        label: "Settings",
        direct: true,
        path: "/app/source-access",
        heading: "Source access",
        copy: ["Backup Meta ad checks"],
      },
      {
        label: "Settings",
        direct: true,
        path: "/app/developer-access",
        heading: "Developer access",
        copy: ["Connect exports and approved actions"],
      },
      { label: "Settings", path: "/app/team", heading: "Team", copy: ["2 of 3 seats in use"], direct: true },
      {
        label: "Deliver",
        direct: true,
        path: "/app/clients",
        heading: "Client rooms",
        copy: ["Keep reviewed evidence and client context"],
      },
      {
        label: "Settings",
        direct: true,
        path: "/app/billing",
        heading: "Billing & usage",
        copy: ["Current plan"],
      },
      {
        label: "Settings",
        direct: true,
        path: "/app/account",
        heading: "Account & security",
        copy: ["Signed in as"],
      },
      {
        label: "Settings",
        direct: true,
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
      // PR-5a: five destinations in the rail; member pages navigate
      // directly and their owning destination row stays visible (and
      // active) in the rail.
      await expect(link, `${route.label} sidebar link should be visible`).toBeVisible();

      if (new URL(page.url()).pathname !== route.path) {
        if (route.direct) {
          await page.goto(route.path);
        } else {
          await Promise.all([
            page.waitForURL((url) => url.pathname === route.path),
            link.click(),
          ]);
        }
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
    }
  });

  test("authenticated buttons and links are wired to real destinations or form actions", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, "e2e-agency");

    const checkedUrls = new Set<string>();
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
      await expectAppActionControlsWired(page, checkedUrls);
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

  // The app-shell cuts are 640px and 1180px. Sample 640/641 for mobile chrome;
  // 760/761 is a search-page-scoped cut that remains load-bearing here through
  // generic .f9-primary-button/.f9-mode-toggle rules. Keep 1024 as the sole
  // width above the 900px f9-evidence-band/detail-body, 920px plan/topup-grid, and
  // 980px dashboard-grid/status-strip/panel-toolbar/work-row cuts.
  for (const { label, viewports } of [
    {
      label: "mobile app chrome",
      viewports: [
        { width: 320, height: 700 },
        { width: 640, height: 900 },
        { width: 641, height: 900 },
      ],
    },
    {
      label: "responsive shell",
      viewports: [
        { width: 760, height: 900 },
        { width: 761, height: 900 },
        { width: 1024, height: 768 },
      ],
    },
  ]) {
    test(`mobile dashboard navigation stays usable across target breakpoints: ${label}`, async ({
      page,
      context,
      baseURL,
    }) => {
      await signInAs(context, baseURL!, "e2e-starter");
      const routes: Array<{ label: string; path: string; heading: string | null; copy: string[]; direct?: boolean }> = [
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
          await expect(page.getByRole("link", { name: "Watch" }).first()).toBeVisible();
          // PR-5a collapsed the mobile nav to the 5 primary destinations
          // (Today / Watch / Library / Deliver / Settings). Settings is the
          // single disclosure that holds the long-dwell routes (Delivery,
          // Source access, Developer access, Team, Billing & usage,
          // Account & security, Help & support); the old peer-row
          // expectations for "Notifications" / "Developer access" are
          // dropped because those rows are no longer rendered as peers.
          // expectMobileSettingsRoutesReachable still proves the
          // disclosure holds the expected settings destinations, and
          // expectMobileNavLinksInContainer still proves every visible
          // row is in the scrolling strip.
          await expect(page.getByRole("link", { name: "Settings" }).first()).toBeVisible();
          await expect(page.getByRole("button", { name: "Sign out" }).first()).toBeVisible();
          await expectNoFixedAppChrome(page);
          await expectNoShellActionRow(page);
          if (viewport.width <= 640) {
            await expectMobileNavLinksInContainer(page);
            await expectMobileSettingsRoutesReachable(page);
          }
          await expectNoHorizontalOverflow(page);
        }
      }
    });
  }

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
