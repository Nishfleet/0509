import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const fixtureCookie = "f9_e2e_fixture";
const fixtureModeHeader = "x-0509-e2e-test-mode";

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

test.describe("local authenticated E2E harness", () => {
  test("new customer is routed to onboarding without magic-link login", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, "e2e-free");
    await page.goto("/app");

    await expect(page).toHaveURL(/\/app\/onboard/);
    await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();
    await expect(page.getByText("Start with one competitor site.")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("starter customer journey covers dashboard, search, watchlists, presence, digests, billing, developer, support, and account", async ({
    page,
    context,
    baseURL,
  }) => {
    await signInAs(context, baseURL!, "e2e-starter");

    await page.goto("/app");
    await expectAppPage(page);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByText("Okara competitor watch")).toBeVisible();

    await page.goto("/search");
    await expect(page.getByRole("heading", { name: "Find competitor ads" })).toBeVisible();

    await page.goto("/app/watchlists");
    await expectAppPage(page);
    await expect(page.getByRole("heading", { name: "Watchlists" })).toBeVisible();
    await expect(page.getByText("Okara competitor watch").first()).toBeVisible();

    await page.goto("/app/presence");
    await expectAppPage(page);
    await expect(page.getByRole("heading", { name: "Website and content presence" })).toBeVisible();
    await expect(page.getByText("Okara")).toBeVisible();

    await page.goto("/app/digests");
    await expectAppPage(page);
    await expect(page.getByRole("heading", { name: "Digests" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Okara launched a new workflow offer" }).first()).toBeVisible();

    await page.goto("/app/billing");
    await expectAppPage(page);
    await expect(page.getByRole("heading", { name: "Billing & usage" })).toBeVisible();
    await expect(page.getByText("Starter plan")).toBeVisible();
    await expect(page.getByText("purchased checks remaining")).toBeVisible();

    await page.goto("/app/sources");
    await expectAppPage(page);
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await page.getByText("Advanced: API keys and external tools").click();
    await expect(page.getByText("Use Five to Nine from your tools")).toBeVisible();
    await page.getByLabel("Key name").fill("Starter denied key");
    await page.getByRole("button", { name: "Create API key" }).click();
    await expect(page.getByText("API access is included in the Agency plan.")).toBeVisible();

    await page.goto("/app/support");
    await expectAppPage(page);
    await expect(page.getByRole("heading", { name: "Help & support" })).toBeVisible();
    await expect(page.getByText("Fixture billing question")).toBeVisible();

    await page.goto("/app/account");
    await expectAppPage(page);
    await expect(page.getByRole("heading", { name: "Account & security" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "E2E Starter" })).toBeVisible();
    await expect(page.getByLabel("My brand website")).toHaveValue("https://starter.example.invalid");
  });

  test("scout journey shows weekly cadence and gates starter or agency controls honestly", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, "e2e-scout");

    await page.goto("/app");
    await expectAppPage(page);
    await expect(page.getByText("Scout weekly watch")).toBeVisible();
    await expect(page.getByText("weekly", { exact: false })).toBeVisible();

    await page.goto("/app/digests");
    await expect(page.getByRole("heading", { name: "Digests" })).toBeVisible();

    await page.goto("/app/sources");
    await page.getByText("Advanced: API keys and external tools").click();
    await page.getByLabel("Key name").fill("Scout denied key");
    await page.getByRole("button", { name: "Create API key" }).click();
    await expect(page.getByText("API access is included in the Agency plan.")).toBeVisible();
  });

  test("agency fixture exposes developer controls without enabling unavailable social delivery", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, "e2e-agency");

    await page.goto("/app/sources");
    await expectAppPage(page);
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await page.getByText("Advanced: API keys and external tools").click();
    await expect(page.getByText("Fixture read-only key")).toBeVisible();
    await expect(
      page.getByText("this does not add automated TikTok, Google, LinkedIn, or Pinterest ingestion"),
    ).toBeVisible();

    await page.goto("/app/reports/watchlist:e2e-watchlist-agency-1");
    await expectAppPage(page);
    await expect(page.getByRole("heading", { name: "Client-ready report" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Okara launched a new workflow offer" }).first()).toBeVisible();
  });

  test("mobile dashboard navigation stays usable across target breakpoints", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, "e2e-starter");
    const viewports = [
      { width: 320, height: 700 },
      { width: 375, height: 812 },
      { width: 430, height: 932 },
      { width: 760, height: 900 },
      { width: 761, height: 900 },
    ];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto("/app");
      await expectAppPage(page);
      await expect(page.getByRole("link", { name: "Watchlists" }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Notifications" }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  });

  test("error and permission states are customer-safe", async ({ page, context, baseURL }) => {
    await signInAs(context, baseURL!, "e2e-starter");

    await page.goto("/app/reports/watchlist:missing-fixture");
    await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Contact support" })).toBeVisible();
    await expect(page.getByText("stack", { exact: false })).toHaveCount(0);
    await expect(page.getByText("D1", { exact: false })).toHaveCount(0);

    await signInAs(context, baseURL!, "e2e-free");
    await page.goto("/app/digests");
    await expect(page.getByRole("heading", { name: "Choose a plan to start monitoring" })).toBeVisible();
    await expect(page.getByText("Current plan: free")).toBeVisible();
  });
});
